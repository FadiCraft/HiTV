const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// دالة تحويل الترجمة من XML إلى SRT
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
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const albumUrl = 'https://home.hitv.vip/ar-ae/gallery';
    await page.goto(albumUrl, { waitUntil: 'networkidle2' });

    // استخراج الأفلام بناءً على الهيكل الجديد
    const movies = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.series-wrapper')).map(el => {
            const linkEl = el.querySelector('a');
            const imgEl = el.querySelector('img.van-image__img');
            return {
                title: linkEl?.getAttribute('title') || 'NoTitle',
                url: linkEl?.href || '',
                image: imgEl?.getAttribute('data-src') || imgEl?.src || ''
            };
        }).filter(m => m.url.includes('/movie/')); // تصفية الروابط التي تحتوي على movie فقط
    });

    console.log(`🔍 تم العثور على ${movies.length} فيلم.`);
    const results = [];

    for (let movie of movies) {
        console.log(`🎬 جاري معالجة الفيلم: ${movie.title}`);
        
        let foundM3u8 = "";
        let foundSub = "";

        // تفعيل التنصت على الشبكة لجلب الروابط
        await page.setRequestInterception(true);
        const requestListener = (request) => {
            const url = request.url();
            if (url.includes('.m3u8')) foundM3u8 = url;
            if (url.includes('.xml') && url.includes('subtitle')) foundSub = url;
            request.continue();
        };
        page.on('request', requestListener);

        try {
            await page.goto(movie.url, { waitUntil: 'networkidle0', timeout: 60000 });
            
            // ننتظر قليلاً للتأكد من تحميل المشغل والروابط
            await new Promise(r => setTimeout(r, 10000));

            const srtPath = await downloadAndConvertSub(foundSub, movie.title);

            results.push({
                title: movie.title,
                image: movie.image,
                url: movie.url,
                m3u8_url: foundM3u8,
                subtitle_path: srtPath || "لم يتم العثور على ترجمة"
            });

            console.log(`   ✅ تم الاستخراج: ${foundM3u8 ? 'رابط الفيديو جاهز' : 'فشل جلب الفيديو'}`);

        } catch (err) {
            console.log(`   ❌ خطأ أثناء معالجة ${movie.title}: ${err.message}`);
        } finally {
            // إيقاف التنصت لتجنب التداخل مع الفيلم التالي
            page.off('request', requestListener);
            await page.setRequestInterception(false);
        }
    }

    fs.writeFileSync('movies_data.json', JSON.stringify(results, null, 2));
    console.log("🏁 انتهى العمل. تم حفظ البيانات في movies_data.json");
    await browser.close();
}

startScraping();
