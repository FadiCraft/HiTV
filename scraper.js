const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// دالة التحويل سريعة ولا تحتاج تعديل
async function downloadAndConvertSub(url, title, epNum) {
    if (!url) return null;
    try {
        const response = await axios.get(url, { timeout: 5000 });
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
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'] 
    });
    
    const page = await browser.newPage();
    // تقليل استهلاك الموارد لتسريع التصفح
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'font', 'stylesheet'].includes(req.resourceType()) && !req.url().includes('hitv')) {
            req.abort(); // منع تحميل الصور والخطوط لتوفير الوقت والبيانات
        } else {
            req.continue();
        }
    });

    const albumUrl = 'https://home.hitv.vip/ar-ae/album/a_MT4IPBbd_619kbg8HYh1g';
    await page.goto(albumUrl, { waitUntil: 'domcontentloaded' });

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
        console.log(`⚡ Fast Processing: ${movie.title}`);
        
        let movieData = { title: movie.title, image: movie.image, original_url: movie.url };

        try {
            await page.goto(movie.url, { waitUntil: 'networkidle2' });

            const episodes = await page.evaluate(() => {
                const seen = new Set();
                return Array.from(document.querySelectorAll('.play-item'))
                    .map(el => el.innerText.trim())
                    .filter(txt => txt && !isNaN(txt) && !seen.has(txt) && seen.add(txt));
            });

            // استخراج الروابط بالتوازي جزئياً
            for (let i = 1; i <= episodes.length; i++) {
                // تقليل الـ timeout لـ 7 ثوانٍ لأن الموقع سريع في طلب الروابط
                const responsePromise = new Promise((resolve) => {
                    let found = { m3u8: "", sub: "" };
                    const listener = (res) => {
                        const url = res.url();
                        if (url.includes('.m3u8')) found.m3u8 = url;
                        if (url.includes('.xml') && url.includes('subtitle')) found.sub = url;
                        if (found.m3u8 && found.sub) {
                            page.off('response', listener);
                            resolve(found);
                        }
                    };
                    page.on('response', listener);
                    // حد أقصى للانتظار لكل حلقة
                    setTimeout(() => { page.off('response', listener); resolve(found); }, 7000);
                });

                await page.evaluate((num) => {
                    const btn = Array.from(document.querySelectorAll('.play-item')).find(el => el.innerText.trim() == num);
                    if (btn) btn.click();
                }, i);

                const links = await responsePromise;

                movieData[`m3u8_epc${i}`] = links.m3u8;
                const srtPath = await downloadAndConvertSub(links.sub, movie.title, i);
                movieData[`srt_epc${i}`] = srtPath || "";
                
                console.log(`  Done E${i}`);
            }
            results.push(movieData);
        } catch (err) {
            console.log(`Error: ${err.message}`);
        }
    }

    fs.writeFileSync('movies.json', JSON.stringify(results, null, 2));
    console.log("🚀 Finished in record time!");
    await browser.close();
}

startScraping();
