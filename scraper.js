const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// وظيفة لتحميل الترجمة بصيغة SRT
async function downloadSub(url, title, epNum) {
    if (!url) return null;
    try {
        const response = await axios.get(url);
        const fileName = `${title.replace(/[/\\?%*:|"<>]/g, '-')}_E${epNum}.srt`;
        const dir = './subtitles';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, response.data);
        return filePath;
    } catch (error) { 
        console.log(`   - Skipping Subtitle: ${error.message}`);
        return null; 
    }
}

async function startScraping() {
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ] 
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const targetUrl = 'https://kisskh.do/Explore?type=2&order=2';
    console.log(`Step 1: Navigating to Explore page...`);
    
    try {
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // استخراج بطاقات الأفلام
        const movies = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('app-main-card'));
            return cards.map(card => {
                const titleEl = card.querySelector('.mat-card-title');
                const imgEl = card.querySelector('img');
                const route = card.getAttribute('route');
                return {
                    title: titleEl ? titleEl.innerText.trim() : 'No Title',
                    url: route ? (window.location.origin + route) : null,
                    image: imgEl ? (imgEl.getAttribute('data-src') || imgEl.src) : ''
                };
            }).filter(m => m.url !== null);
        });

        console.log(`Step 2: Found ${movies.length} items to process.`);

        const results = [];

        for (let movie of movies) {
            console.log(`\n--- Processing: ${movie.title} ---`);
            let movieData = {
                title: movie.title,
                image: movie.image,
                original_url: movie.url,
                episodes: []
            };

            try {
                await page.goto(movie.url, { waitUntil: 'networkidle2', timeout: 60000 });

                // الانتظار حتى تظهر أزرار الحلقات (Angular Material)
                await page.waitForSelector('button.mat-raised-button', { timeout: 20000 }).catch(() => null);

                const episodeList = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button.mat-raised-button'));
                    return buttons.map(btn => btn.innerText.replace(/[^0-9]/g, '').trim())
                                  .filter(txt => txt !== "");
                });

                if (episodeList.length === 0) {
                    console.log(`   - No episodes found for this item.`);
                    continue;
                }

                console.log(`   - Found ${episodeList.length} episodes. Starting extraction...`);

                for (let epNum of episodeList) {
                    let currentM3u8 = "";
                    let currentSub = "";

                    // اعتراض الروابط
                    await page.setRequestInterception(true);
                    const intercept = (request) => {
                        const url = request.url();
                        if (url.includes('.m3u8')) currentM3u8 = url;
                        if (url.includes('.srt')) currentSub = url;
                        request.continue();
                    };
                    page.on('request', intercept);

                    // النقر على الحلقة
                    await page.evaluate((num) => {
                        const buttons = Array.from(document.querySelectorAll('button.mat-raised-button'));
                        const target = buttons.find(b => b.innerText.includes(num));
                        if (target) target.click();
                    }, epNum);

                    // انتظار تحميل المشغل (7 ثوانٍ كافية لالتقاط الروابط)
                    await new Promise(r => setTimeout(r, 7000));

                    const srtPath = await downloadSub(currentSub, movie.title, epNum);

                    movieData.episodes.push({
                        episode: epNum,
                        m3u8: currentM3u8,
                        subtitle_url: currentSub,
                        local_subtitle: srtPath || ""
                    });

                    await page.setRequestInterception(false);
                    page.removeAllListeners('request');
                    console.log(`     > Episode ${epNum}: Done`);
                }

                results.push(movieData);
            } catch (err) {
                console.log(`   - Error processing ${movie.title}: ${err.message}`);
            }
        }

        // حفظ النتائج في ملف JSON
        fs.writeFileSync('movies.json', JSON.stringify(results, null, 2));
        console.log(`\nSuccess: Data saved to movies.json`);

    } catch (mainErr) {
        console.log(`Critical Error: ${mainErr.message}`);
    } finally {
        await browser.close();
    }
}

startScraping();
