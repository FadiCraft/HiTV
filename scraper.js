const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

async function convertXmlToSrt(xmlUrl, outputFileName) {
    try {
        const response = await axios.get(xmlUrl);
        const xmlData = response.data;
        // منطق بسيط لتحويل XML الخاص بـ HiTV إلى SRT (يعتمد على بنية الملف)
        // ملاحظة: قد تحتاج لتعديل regex حسب بنية الـ XML الدقيقة
        let srtContent = '';
        let index = 1;
        const matches = xmlData.matchAll(/<text start="([\d.]+)" end="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g);

        for (const match of matches) {
            const start = formatSrtTime(match[1]);
            const end = formatSrtTime(match[2]);
            const text = match[3].replace(/<[^>]+>/g, '').trim();
            srtContent += `${index}\n${start} --> ${end}\n${text}\n\n`;
            index++;
        }
        fs.writeFileSync(outputFileName, srtContent);
        return outputFileName;
    } catch (error) {
        console.error(`Error converting subtitle: ${error.message}`);
        return null;
    }
}

function formatSrtTime(seconds) {
    const date = new Date(seconds * 1000);
    const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss},${ms}`;
}

async function scrape() {
    const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const targetUrl = 'https://home.hitv.vip/ar-ae/album/a_MT4IPBbd_619kbg8HYh1g';

    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    const movies = await page.evaluate(() => {
        const items = document.querySelectorAll('.album');
        return Array.from(items).map(item => {
            const anchor = item.querySelector('a.vertical-poster');
            const img = item.querySelector('img.van-image__img');
            return {
                title: anchor ? anchor.getAttribute('title') : '',
                url: anchor ? anchor.href : '',
                image: img ? (img.getAttribute('data-src') || img.src) : ''
            };
        });
    });

    const results = [];

    for (let movie of movies) {
        console.log(`Processing: ${movie.title}`);
        try {
            await page.goto(movie.url, { waitUntil: 'networkidle2' });
            
            // استخراج رابط m3u8 من الشبكة أو العناصر
            const m3u8 = await page.evaluate(() => {
                // محاولة إيجاد الرابط في متغيرات الصفحة أو مشغل الفيديو
                return window.__NUXT__?.state?.videoInfo?.m3u8Url || ""; 
            });

            // استخراج رابط الترجمة
            const subtitleXml = await page.evaluate(() => {
                return window.__NUXT__?.state?.videoInfo?.subtitles?.find(s => s.lang === 'ar')?.url || "";
            });

            let srtFile = null;
            if (subtitleXml) {
                const fileName = `subtitles/${movie.title.replace(/\s+/g, '_')}.srt`;
                if (!fs.existsSync('subtitles')) fs.mkdirSync('subtitles');
                srtFile = await convertXmlToSrt(subtitleXml, fileName);
            }

            results.push({
                ...movie,
                m3u8_url: m3u8,
                subtitle_xml: subtitleXml,
                subtitle_srt: srtFile
            });
        } catch (e) {
            console.error(`Failed to scrape ${movie.title}`);
        }
    }

    fs.writeFileSync('movies.json', JSON.stringify(results, null, 2));
    await browser.close();
}

scrape();
