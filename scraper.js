const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// وظيفة تحويل XML إلى SRT
async function downloadAndConvertSub(url, title) {
    if (!url) return null;
    try {
        const response = await axios.get(url);
        const xmlData = response.data;
        let srtContent = '';
        let index = 1;

        // استخراج نصوص الترجمة والوقت (بناءً على هيكلة HiTV المشهورة)
        const matches = xmlData.matchAll(/<text start="([\d.]+)" end="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g);
        
        for (const match of matches) {
            const start = formatTime(parseFloat(match[1]));
            const end = formatTime(parseFloat(match[2]));
            const text = match[3].replace(/<[^>]+>/g, '').trim(); // تنظيف الوسوم
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
    } catch (error) {
        console.error(`خطأ في تحويل الترجمة لـ ${title}: ${error.message}`);
        return null;
    }
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
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');

    const albumUrl = 'https://home.hitv.vip/ar-ae/album/a_MT4IPBbd_619kbg8HYh1g';
    
    try {
        console.log("جارٍ تحميل صفحة الألبوم...");
        await page.goto(albumUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        const movies = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.album')).map(el => ({
                title: el.querySelector('a')?.getAttribute('title') || 'Unknown',
                url: el.querySelector('a')?.href || '',
                image: el.querySelector('img')?.getAttribute('data-src') || el.querySelector('img')?.src || ''
            }));
        });

        console.log(`تم العثور على ${movies.length} فيلم/مسلسل.`);
        const results = [];

        for (let movie of movies) {
            if (!movie.url) continue;
            console.log(`جارٍ استخراج بيانات: ${movie.title}`);
            
            try {
                await page.goto(movie.url, { waitUntil: 'networkidle2', timeout: 60000 });
                
                // البحث عن الروابط في بيانات الصفحة (NUXT)
                const videoData = await page.evaluate(() => {
                    const data = window.__NUXT__?.data[0] || {};
                    const info = data.videoInfo || {};
                    return {
                        m3u8: info.playUrl || "",
                        subs: info.subtitles || []
                    };
                });

                const arabicSubObj = videoData.subs.find(s => s.lang === 'ar') || {};
                const srtPath = await downloadAndConvertSub(arabicSubObj.url, movie.title);

                results.push({
                    title: movie.title,
                    image: movie.image,
                    m3u8_url: videoData.m3u8,
                    original_subtitle: arabicSubObj.url || "",
                    local_srt: srtPath || ""
                });

            } catch (err) {
                console.error(`فشل استخراج ${movie.title}: ${err.message}`);
            }
        }

        fs.writeFileSync('movies.json', JSON.stringify(results, null, 2));
        console.log("تم الانتهاء وحفظ movies.json");

    } catch (error) {
        console.error("خطأ عام في السكريبت:", error.message);
    } finally {
        await browser.close();
    }
}

startScraping();
