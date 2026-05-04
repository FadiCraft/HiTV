const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

async function downloadAndConvertSub(url, title) {
    if (!url) return null;
    try {
        const response = await axios.get(url);
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
    } catch (error) { return null; }
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
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const albumUrl = 'https://home.hitv.vip/ar-ae/album/a_MT4IPBbd_619kbg8HYh1g';
    
    console.log("جارٍ فتح صفحة الألبوم...");
    await page.goto(albumUrl, { waitUntil: 'networkidle2' });

    const movies = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.album')).map(el => ({
            title: el.querySelector('a')?.getAttribute('title') || 'NoTitle',
            url: el.querySelector('a')?.href || '',
            image: el.querySelector('img')?.getAttribute('data-src') || el.querySelector('img')?.src || ''
        }));
    });

    console.log(`تم العثور على ${movies.length} عنصر.`);
    const results = [];

    for (let movie of movies) {
        if (!movie.url) continue;
        console.log(`جارٍ استخراج: ${movie.title}`);
        
        let foundM3u8 = "";
        let foundSub = "";

        await page.setRequestInterception(true);
        const requestHandler = (request) => {
            const url = request.url();
            if (url.includes('.m3u8')) {
                foundM3u8 = url;
                console.log(`  [M3U8 Found]`);
            }
            if (url.includes('.xml') && (url.includes('subtitle') || url.includes('hitv'))) {
                foundSub = url;
                console.log(`  [Subtitle Found]`);
            }
            request.continue();
        };

        page.on('request', requestHandler);

        try {
            await page.goto(movie.url, { waitUntil: 'networkidle0', timeout: 60000 });
            
            // محاكاة حركة بسيطة لتفعيل المشغل (أحياناً لا يرسل طلبات إلا عند التفاعل)
            await page.mouse.wheel(0, 500);
            await new Promise(r => setTimeout(r, 8000)); // انتظر 8 ثوانٍ لالتقاط الروابط

            const srtPath = await downloadAndConvertSub(foundSub, movie.title);

            results.push({
                title: movie.title,
                image: movie.image,
                m3u8_url: foundM3u8,
                original_subtitle: foundSub,
                local_srt: srtPath || ""
            });
        } catch (err) {
            console.log(`خطأ في ${movie.title}: ${err.message}`);
        }
        
        await page.setRequestInterception(false);
        page.off('request', requestHandler);
    }

    fs.writeFileSync('movies.json', JSON.stringify(results, null, 2));
    console.log("تم تحديث movies.json بنجاح.");
    await browser.close();
}

startScraping();
