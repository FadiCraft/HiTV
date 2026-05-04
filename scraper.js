const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

async function downloadAndConvertSub(url, title, epNum) {
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
        const fileName = `${title.replace(/[/\\?%*:|"<>]/g, '-')}_E${epNum}.srt`;
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
        console.log(`Processing Series: ${movie.title}`);
        
        let movieData = {
            title: movie.title,
            image: movie.image,
            original_url: movie.url
        };

        try {
            await page.goto(movie.url, { waitUntil: 'networkidle0', timeout: 60000 });

            // استخراج عدد الحلقات (العناصر القابلة للضغط)
            const episodeCount = await page.evaluate(() => {
                return document.querySelectorAll('.play-item').length;
            });

            console.log(`Found ${episodeCount} episodes for ${movie.title}`);

            for (let i = 1; i <= episodeCount; i++) {
                let currentM3u8 = "";
                let currentSub = "";

                // التنصت لالتقاط روابط الحلقة الحالية فقط
                const intercept = (request) => {
                    const url = request.url();
                    if (url.includes('.m3u8')) currentM3u8 = url;
                    if (url.includes('.xml') && url.includes('subtitle')) currentSub = url;
                };

                await page.setRequestInterception(true);
                page.on('request', request => { intercept(request); request.continue(); });

                // النقر على الحلقة رقم i
                await page.evaluate((idx) => {
                    const eps = document.querySelectorAll('.play-item');
                    if (eps[idx - 1]) eps[idx - 1].click();
                }, i);

                // انتظار تحميل بيانات الحلقة
                await new Promise(r => setTimeout(r, 6000));

                // تخزين البيانات بالشكل الذي طلبته للسكتشوير
                movieData[`m3u8_epc${i}`] = currentM3u8;
                const srtLocalPath = await downloadAndConvertSub(currentSub, movie.title, i);
                movieData[`srt_epc${i}`] = srtLocalPath || "";

                // تنظيف المستمعين للحلقة القادمة
                await page.setRequestInterception(false);
                page.removeAllListeners('request');
                
                console.log(`  - Episode ${i} captured.`);
            }

            results.push(movieData);
        } catch (err) {
            console.log(`Error in series ${movie.title}: ${err.message}`);
        }
    }

    fs.writeFileSync('movies.json', JSON.stringify(results, null, 2));
    console.log("Scraping Completed. JSON saved for Sketchware.");
    await browser.close();
}

startScraping();
