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

            // اختيار الحلقات الفريدة فقط بناءً على رقم الحلقة الظاهر
            const episodes = await page.evaluate(() => {
                const allItems = Array.from(document.querySelectorAll('.play-item'));
                const uniqueEps = [];
                const seenNumbers = new Set();

                allItems.forEach(item => {
                    const text = item.innerText.trim();
                    // نتحقق أن النص رقم وأننا لم نضفه من قبل
                    if (text && !isNaN(text) && !seenNumbers.has(text)) {
                        seenNumbers.add(text);
                        uniqueEps.push(text);
                    }
                });
                return uniqueEps;
            });

            const episodeCount = episodes.length;
            console.log(`Verified: ${episodeCount} unique episodes for ${movie.title}`);

            for (let i = 1; i <= episodeCount; i++) {
                let currentM3u8 = "";
                let currentSub = "";

                await page.setRequestInterception(true);
                const intercept = (request) => {
                    const url = request.url();
                    if (url.includes('.m3u8')) currentM3u8 = url;
                    if (url.includes('.xml') && url.includes('subtitle')) currentSub = url;
                    request.continue();
                };
                page.on('request', intercept);

                // النقر على الحلقة رقم i (بناءً على النص الظاهر للحلقة لضمان الدقة)
                await page.evaluate((num) => {
                    const eps = Array.from(document.querySelectorAll('.play-item'));
                    const target = eps.find(el => el.innerText.trim() == num);
                    if (target) target.click();
                }, i);

                await new Promise(r => setTimeout(r, 6000));

                movieData[`m3u8_epc${i}`] = currentM3u8;
                const srtLocalPath = await downloadAndConvertSub(currentSub, movie.title, i);
                movieData[`srt_epc${i}`] = srtLocalPath || "";

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
    console.log("Scraping Completed. Data cleaned from duplicates.");
    await browser.close();
}

startScraping();
