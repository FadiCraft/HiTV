const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// دالة تحويل الترجمة
async function downloadAndConvertSub(url, title) {
    if (!url) return null;
    try {
        const response = await axios.get(url, { timeout: 10000 });
        const xmlData = response.data;
        let srtContent = '';
        let index = 1;
        const matches = xmlData.matchAll(/<text start="([\d.]+)" end="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g);
        for (const match of matches) {
            const start = formatTime(parseFloat(match[1]));
            const end = formatTime(parseFloat(match[2]));
            const text = match[3].replace(/<[^>]+>/g, '').trim();
            if (text) {
                srtContent += `${index}\n${start} --> ${end}\n${text}\n\n`;
                index++;
            }
        }
        const fileName = `${title.replace(/[/\\?%*:|"<>]/g, '-')}.srt`;
        const dir = './subtitles';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, srtContent);
        return filePath;
    } catch (e) { return null; }
}

function formatTime(seconds) {
    const date = new Date(seconds * 1000);
    const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss},${ms}`;
}

// دالة التمرير التلقائي لتحميل المحتوى المخفي
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            let distance = 100;
            let timer = setInterval(() => {
                let scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

async function startScraping() {
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'] 
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const albumUrl = 'https://home.hitv.vip/ar-ae/gallery';
    console.log("🚀 جاري فتح صفحة المعرض...");
    
    try {
        await page.goto(albumUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // انتظار ظهور العناصر الأساسية
        console.log("⏳ بانتظار تحميل العناصر...");
        await page.waitForSelector('.series-wrapper', { timeout: 30000 });

        // عمل Scroll لتحميل كل المسلسلات في الصفحة
        await autoScroll(page);
        await new Promise(r => setTimeout(r, 2000));

        const seriesList = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.series-wrapper')).map(el => {
                const linkEl = el.querySelector('a');
                const imgEl = el.querySelector('img');
                return {
                    title: linkEl?.getAttribute('title')?.trim() || el.querySelector('.name-container')?.innerText?.trim() || 'NoTitle',
                    url: linkEl?.href || '',
                    image: imgEl?.getAttribute('data-src') || imgEl?.src || ''
                };
            }).filter(item => item.url !== '');
        });

        console.log(`🔍 تم العثور على ${seriesList.length} عمل.`);
        const results = [];

        for (let series of seriesList) {
            console.log(`🎬 جاري معالجة: ${series.title}`);
            let foundM3u8 = "";
            let foundSub = "";

            await page.setRequestInterception(true);
            const requestListener = (request) => {
                const url = request.url();
                if (url.includes('.m3u8')) foundM3u8 = url;
                if (url.includes('.xml') && url.includes('subtitle')) foundSub = url;
                request.continue();
            };
            page.on('request', requestListener);

            try {
                await page.goto(series.url, { waitUntil: 'networkidle0', timeout: 60000 });
                await new Promise(r => setTimeout(r, 12000)); // وقت كافٍ للمشغل

                const srtPath = await downloadAndConvertSub(foundSub, series.title);
                results.push({
                    title: series.title,
                    image: series.image,
                    video_url: foundM3u8,
                    subtitle_path: srtPath || ""
                });
                console.log(`   ✅ تم جلب البيانات.`);
            } catch (err) {
                console.log(`   ❌ خطأ: ${err.message}`);
            } finally {
                page.off('request', requestListener);
                await page.setRequestInterception(false);
            }
        }

        fs.writeFileSync('series_data.json', JSON.stringify(results, null, 2));
        console.log("🏁 انتهى العمل بنجاح.");

    } catch (e) {
        console.log("❌ فشل تحميل الصفحة الرئيسية: " + e.message);
    }

    await browser.close();
}

startScraping();
