const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const GITHUB_BASE_URL = "https://raw.githubusercontent.com/FadiCraft/HiTV/refs/heads/main/subtitles/";

// متغيرات عامة لالتقاط الروابط الحالية
let currentM3u8 = "";
let currentSub = "";

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
        const safeTitle = title.replace(/[/\\?%*:|"<> ]/g, '-');
        const fileName = `${safeTitle}_E${epNum}.srt`;
        const dir = './subtitles';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, srtContent);
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
    
    // تفعيل الاعتراض مرة واحدة فقط للسكربت بالكامل
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const url = request.url();
        if (url.includes('.m3u8')) currentM3u8 = url;
        if (url.includes('.xml') && url.includes('subtitle')) currentSub = url;
        
        // إكمال الطلب دائماً لتجنب الخطأ السابق
        request.continue().catch(() => {}); 
    });

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
        
        let movieData = { title: movie.title, image: movie.image, original_url: movie.url };

        try {
            await page.goto(movie.url, { waitUntil: 'networkidle0' });
            const episodes = await page.evaluate(() => {
                const seen = new Set();
                return Array.from(document.querySelectorAll('.play-item'))
                    .map(el => el.innerText.trim())
                    .filter(txt => txt && !isNaN(txt) && !seen.has(txt) && seen.add(txt));
            });

            for (let i = 1; i <= episodes.length; i++) {
                // تصفير المتغيرات قبل كل حلقة
                currentM3u8 = "";
                currentSub = "";

                await page.evaluate((num) => {
                    const btn = Array.from(document.querySelectorAll('.play-item')).find(el => el.innerText.trim() == num);
                    if (btn) btn.click();
                }, i);

                // انتظار كافٍ لالتقاط الروابط
                await new Promise(r => setTimeout(r, 7000));

                movieData[`m3u8_epc${i}`] = currentM3u8;
                movieData[`srt_epc${i}`] = await downloadAndConvertSub(currentSub, movie.title, i) || "";

                console.log(`   ✅ Episode ${i} Done`);
            }
            results.push(movieData);
        } catch (err) {
            console.log(`❌ Error in ${movie.title}: ${err.message}`);
        }
    }

    fs.writeFileSync('movies.json', JSON.stringify(results, null, 2));
    console.log("🏁 انتهى العمل بنجاح.");
    await browser.close();
}

startScraping();
