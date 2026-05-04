const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// دالة تحويل الترجمة
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
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'] 
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const albumUrl = 'https://home.hitv.vip/ar-ae/gallery';
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
        console.log(`🎬 جاري معالجة المسلسل: ${movie.title}`);
        
        let movieData = {
            title: movie.title,
            image: movie.image,
            original_url: movie.url
        };

        try {
            // أولاً: نعرف عدد الحلقات
            await page.goto(movie.url, { waitUntil: 'networkidle0' });
            const episodes = await page.evaluate(() => {
                const seen = new Set();
                return Array.from(document.querySelectorAll('.play-item'))
                    .map(el => el.innerText.trim())
                    .filter(txt => txt && !isNaN(txt) && !seen.has(txt) && seen.add(txt));
            });

            console.log(`📌 تم العثور على ${episodes.length} حلقة.`);

            // ثانياً: نمر على كل حلقة كأنها زيارة جديدة
            for (let i = 1; i <= episodes.length; i++) {
                let foundM3u8 = "";
                let foundSub = "";

                // تفعيل التنصت
                await page.setRequestInterception(true);
                const listener = (request) => {
                    const url = request.url();
                    if (url.includes('.m3u8')) foundM3u8 = url;
                    if (url.includes('.xml') && url.includes('subtitle')) foundSub = url;
                    request.continue();
                };
                page.on('request', listener);

                // الانتقال للحلقة المحددة عبر إضافة query parameter للرابط (إذا كان الموقع يدعمها)
                // أو النقر والانتظار
                await page.goto(movie.url, { waitUntil: 'networkidle0' });
                await page.evaluate((num) => {
                    const btn = Array.from(document.querySelectorAll('.play-item')).find(el => el.innerText.trim() == num);
                    if (btn) btn.click();
                }, i);

                // ننتظر التحميل والـ Network
                await new Promise(r => setTimeout(r, 8000));

                movieData[`m3u8_epc${i}`] = foundM3u8;
                const srtPath = await downloadAndConvertSub(foundSub, movie.title, i);
                movieData[`srt_epc${i}`] = srtPath || "";

                console.log(`   ✅ الحلقة ${i}: ${foundM3u8 ? 'تم جلب الرابط' : 'لم يتم العثور'}`);

                // إغلاق التنصت لهذه الحلقة
                await page.setRequestInterception(false);
                page.off('request', listener);
            }

            results.push(movieData);
        } catch (err) {
            console.log(`❌ خطأ في ${movie.title}: ${err.message}`);
        }
    }

    fs.writeFileSync('movies.json', JSON.stringify(results, null, 2));
    console.log("🏁 انتهى الاستخراج بنجاح.");
    await browser.close();
}

startScraping();
