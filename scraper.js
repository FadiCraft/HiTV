const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// الرابط الأساسي للمستودع الخاص بك
const GITHUB_BASE_URL = "https://raw.githubusercontent.com/FadiCraft/HiTV/refs/heads/main/subtitles/";

async function downloadAndConvertSub(url, title, epNum) {
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
        
        // تنظيف الاسم ليكون متوافقاً مع روابط الـ URL
        const safeTitle = title.replace(/[/\\?%*:|"<> ]/g, '-');
        const fileName = `${safeTitle}_E${epNum}.srt`;
        const dir = './subtitles';
        
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, srtContent);
        
        // إرجاع الرابط الكامل بدلاً من المسار المحلي
        return GITHUB_BASE_URL + fileName;
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
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const albumUrl = 'https://home.hitv.vip/ar-ae/album/a_MT4IPBbd_619kbg8HYh1g';
    await page.goto(albumUrl, { waitUntil: 'networkidle2' });

    const movies = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.album')).map(el => ({
            title: el.querySelector('a')?.getAttribute('title') || 'NoTitle',
            url: el.querySelector('a')?.href || '',
            image: el.querySelector('img')?.getAttribute('data-src') || el.querySelector('img')?.src || ''
        }));
    });

    const results = [];

    for (let movie of movies) {
        if (!movie.url) continue;
        console.log(`🎬 جاري معالجة: ${movie.title}`);
        
        let movieData = {
            title: movie.title,
            image: movie.image,
            original_url: movie.url
        };

        try {
            await page.goto(movie.url, { waitUntil: 'networkidle0' });
            const episodes = await page.evaluate(() => {
                const seen = new Set();
                return Array.from(document.querySelectorAll('.play-item'))
                    .map(el => el.innerText.trim())
                    .filter(txt => txt && !isNaN(txt) && !seen.has(txt) && seen.add(txt));
            });

            for (let i = 1; i <= episodes.length; i++) {
                let foundM3u8 = "";
                let foundSub = "";

                await page.setRequestInterception(true);
                const listener = (request) => {
                    const url = request.url();
                    if (url.includes('.m3u8')) foundM3u8 = url;
                    if (url.includes('.xml') && url.includes('subtitle')) foundSub = url;
                    request.continue();
                };
                page.on('request', listener);

                await page.goto(movie.url, { waitUntil: 'networkidle0' });
                await page.evaluate((num) => {
                    const btn = Array.from(document.querySelectorAll('.play-item')).find(el => el.innerText.trim() == num);
                    if (btn) btn.click();
                }, i);

                await new Promise(r => setTimeout(r, 8000));

                movieData[`m3u8_epc${i}`] = foundM3u8;
                // هنا سيتم تخزين الرابط الكامل مباشرة
                movieData[`srt_epc${i}`] = await downloadAndConvertSub(foundSub, movie.title, i) || "";

                console.log(`   ✅ Episode ${i} Done`);

                await page.setRequestInterception(false);
                page.off('request', listener);
            }

            results.push(movieData);
        } catch (err) {
            console.log(`❌ Error: ${err.message}`);
        }
    }

    fs.writeFileSync('movies.json', JSON.stringify(results, null, 2));
    console.log("🏁 انتهى الاستخراج بنجاح.");
    await browser.close();
}

startScraping();
