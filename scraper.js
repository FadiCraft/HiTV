const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

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

async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            let distance = 200;
            let timer = setInterval(() => {
                let scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight || totalHeight > 5000) { // توقف بعد مسافة معينة لتجنب اللانهائية
                    clearInterval(timer);
                    resolve();
                }
            }, 150);
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
    
    const albumUrl = 'https://home.hitv.vip/ar-ae/gallery';
    console.log("🚀 جاري الدخول إلى المعرض...");

    try {
        await page.goto(albumUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // التمرير لتحميل محتوى الـ Lazy Load
        await autoScroll(page);
        await new Promise(r => setTimeout(r, 3000));

        const seriesList = await page.evaluate(() => {
            // استهداف wrapper المسلسل
            const wrappers = Array.from(document.querySelectorAll('.series-wrapper'));
            return wrappers.map(el => {
                const link = el.querySelector('a');
                // استخراج العنوان من aria-label لأنه الأدق في الهيكل الذي أرسلته
                const title = el.querySelector('[aria-label]')?.getAttribute('aria-label') || link?.getAttribute('title') || "No Title";
                const img = el.querySelector('img.van-image__img');
                
                return {
                    title: title.trim(),
                    url: link?.href || '',
                    // تفضيل data-src لأن src قد يكون base64 مؤقت
                    image: img?.getAttribute('data-src') || img?.src || ''
                };
            }).filter(item => item.url && item.url.includes('/series/'));
        });

        console.log(`🔍 تم العثور على ${seriesList.length} عمل.`);
        const results = [];

        for (let item of seriesList) {
            console.log(`🎬 جاري فحص: ${item.title}`);
            let foundM3u8 = "";
            let foundSub = "";

            await page.setRequestInterception(true);
            const listener = (req) => {
                const url = req.url();
                if (url.includes('.m3u8')) foundM3u8 = url;
                if (url.includes('.xml') && url.includes('subtitle')) foundSub = url;
                req.continue();
            };
            page.on('request', listener);

            try {
                await page.goto(item.url, { waitUntil: 'networkidle0', timeout: 60000 });
                // ننتظر قليلاً لضمان أن المشغل طلب الروابط
                await new Promise(r => setTimeout(r, 12000));

                const srtPath = await downloadAndConvertSub(foundSub, item.title);
                results.push({
                    title: item.title,
                    image: item.image,
                    video_url: foundM3u8,
                    subtitle_path: srtPath || ""
                });
                console.log(`   ✅ تم بنجاح.`);
            } catch (err) {
                console.log(`   ❌ خطأ في ${item.title}: ${err.message}`);
            } finally {
                page.off('request', listener);
                await page.setRequestInterception(false);
            }
        }

        fs.writeFileSync('series_data.json', JSON.stringify(results, null, 2));
        console.log("🏁 انتهى الاستخراج.");

    } catch (e) {
        console.log("❌ خطأ عام: " + e.message);
    }

    await browser.close();
}

startScraping();
