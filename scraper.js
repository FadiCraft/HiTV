const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// وظيفة لتحميل الترجمة (بما أنها SRT مباشرة الآن، نقوم بحفظها فقط)
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
        console.log(`Error downloading sub: ${error.message}`);
        return null; 
    }
}

async function startScraping() {
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'] 
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    // إعداد الـ User Agent ليبدو كمتصفح حقيقي
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const targetUrl = 'https://kisskh.do/Explore?type=2&order=2';
    console.log(`Navigating to: ${targetUrl}`);
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    // استخراج بيانات البطاقات (المسلسلات)
    const movies = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('app-main-card'));
        return cards.map(card => {
            const titleEl = card.querySelector('.mat-card-title');
            const imgEl = card.querySelector('img');
            const linkEl = card.querySelector('mat-card'); // الرابط غالباً يكون في الـ route الخاص بـ app-main-card
            
            // استخراج الـ Route من الخاصية المخصصة
            const route = card.getAttribute('route') || "";
            
            return {
                title: titleEl ? titleEl.innerText.trim() : 'No Title',
                url: route ? (window.location.origin + route) : '',
                image: imgEl ? (imgEl.getAttribute('data-src') || imgEl.src) : ''
            };
        });
    });

    console.log(`Found ${movies.length} items.`);

    const results = [];

    for (let movie of movies) {
        if (!movie.url) continue;
        console.log(`Processing: ${movie.title}`);
        
        let movieData = {
            title: movie.title,
            image: movie.image,
            original_url: movie.url,
            episodes: []
        };

        try {
            await page.goto(movie.url, { waitUntil: 'networkidle0', timeout: 60000 });

            // استخراج الحلقات من الأزرار (Buttons)
            const episodeButtons = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button.mat-raised-button'));
                return buttons.map(btn => ({
                    epNum: btn.innerText.replace('closed_caption', '').trim(),
                    // لا يوجد رابط مباشر في الزر، نحتاج للنقر عليه
                })).filter(b => b.epNum !== "");
            });

            console.log(`Found ${episodeButtons.length} episodes.`);

            for (let ep of episodeButtons) {
                let currentM3u8 = "";
                let currentSub = "";

                // تفعيل اعتراض الطلبات لالتقاط الروابط
                await page.setRequestInterception(true);
                const intercept = (request) => {
                    const url = request.url();
                    if (url.includes('.m3u8')) currentM3u8 = url;
                    if (url.includes('.srt')) currentSub = url;
                    request.continue();
                };
                page.on('request', intercept);

                // النقر على زر الحلقة
                await page.evaluate((num) => {
                    const buttons = Array.from(document.querySelectorAll('button.mat-raised-button'));
                    const target = buttons.find(b => b.innerText.includes(num));
                    if (target) target.click();
                }, ep.epNum);

                // انتظار تحميل المشغل والروابط
                await new Promise(r => setTimeout(r, 7000));

                const srtPath = await downloadSub(currentSub, movie.title, ep.epNum);

                movieData.episodes.push({
                    episode: ep.epNum,
                    m3u8: currentM3u8,
                    subtitle: srtPath || currentSub
                });

                // إيقاف الاعتراض للدورة القادمة
                await page.setRequestInterception(false);
                page.removeAllListeners('request');
                
                console.log(`  - Episode ${ep.epNum} captured.`);
            }

            results.push(movieData);
        } catch (err) {
            console.log(`Error in: ${movie.title}: ${err.message}`);
        }
    }

    fs.writeFileSync('kisskh_data.json', JSON.stringify(results, null, 2));
    console.log("Finished! Check kisskh_data.json");
    await browser.close();
}

startScraping();
