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

async function startScraping() {
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'] 
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    const albumUrl = 'https://home.hitv.vip/ar-ae/gallery';
    console.log("🚀 جاري الدخول إلى المعرض...");

    try {
        // ننتظر حتى استقرار الشبكة تماماً
        await page.goto(albumUrl, { waitUntil: 'networkidle0', timeout: 90000 });

        // انتظار قسري لأي عنصر يحمل رابط مسلسل
        console.log("⏳ بانتظار ظهور المسلسلات في الصفحة...");
        try {
            await page.waitForSelector('a[href*="/series/"]', { timeout: 30000 });
        } catch (e) {
            console.log("⚠️ تحذير: لم يتم العثور على المحدد الرئيسي، سأحاول الاستخراج المباشر.");
        }

        const seriesList = await page.evaluate(() => {
            // سنبحث عن أي رابط يحتوي على كلمة series
            const anchors = Array.from(document.querySelectorAll('a[href*="/series/"]'));
            
            return anchors.map(a => {
                const wrapper = a.closest('.series-wrapper') || a.parentElement;
                const img = wrapper.querySelector('img');
                const title = a.getAttribute('title') || a.querySelector('[aria-label]')?.getAttribute('aria-label') || a.innerText;
                
                return {
                    title: title ? title.trim() : "No Title",
                    url: a.href,
                    image: img ? (img.getAttribute('data-src') || img.src) : ""
                };
            }).filter((v, i, a) => a.findIndex(t => t.url === v.url) === i); // حذف الروابط المكررة
        });

        console.log(`🔍 تم العثور على ${seriesList.length} عمل.`);
        const results = [];

        for (let item of seriesList) {
            if (!item.url) continue;
            console.log(`🎬 معالجة: ${item.title}`);
            
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
                await page.goto(item.url, { waitUntil: 'networkidle2', timeout: 45000 });
                await new Promise(r => setTimeout(r, 10000));

                const srtPath = await downloadAndConvertSub(foundSub, item.title);
                results.push({
                    title: item.title,
                    image: item.image,
                    video_url: foundM3u8,
                    subtitle_path: srtPath || ""
                });
                console.log(`   ✅ تم.`);
            } catch (err) {
                console.log(`   ❌ خطأ في ${item.title}`);
            } finally {
                page.off('request', listener);
                await page.setRequestInterception(false);
            }
        }

        fs.writeFileSync('series_data.json', JSON.stringify(results, null, 2));
        console.log("🏁 انتهى العمل.");

    } catch (e) {
        console.log("❌ خطأ: " + e.message);
    }

    await browser.close();
}

startScraping();
