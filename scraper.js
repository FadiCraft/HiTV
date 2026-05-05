const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

async function downloadSub(url, title, epNum) {
    if (!url || !url.startsWith('http')) return null;
    try {
        const response = await axios.get(url);
        const fileName = `${title.replace(/[/\\?%*:|"<>]/g, '-')}_E${epNum}.srt`;
        const dir = './subtitles';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, response.data);
        return filePath;
    } catch (error) { return null; }
}

async function startScraping() {
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'] 
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // تفعيل اعتراض الطلبات مرة واحدة فقط على مستوى المتصفح لتجنب التداخل
    let currentM3u8 = "";
    let currentSub = "";
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const url = request.url();
        if (url.includes('.m3u8')) currentM3u8 = url;
        if (url.includes('.srt')) currentSub = url;
        request.continue().catch(() => {});
    });

    try {
        const targetUrl = 'https://kisskh.do/Explore?type=2&order=2';
        console.log(`🚀 Start: ${targetUrl}`);
        
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        const movies = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('app-main-card')).map(card => ({
                title: card.querySelector('.mat-card-title')?.innerText.trim(),
                url: window.location.origin + card.getAttribute('route')
            })).filter(m => m.title && m.url.includes('/Drama'));
        });

        console.log(`✅ Found ${movies.length} Series.`);
        const results = [];

        for (let movie of movies) {
            console.log(`\n🔍 Processing: ${movie.title}`);
            
            try {
                await page.goto(movie.url, { waitUntil: 'networkidle0', timeout: 60000 });
                
                // انتظار ظهور أزرار الحلقات
                await page.waitForSelector('button.mat-raised-button', { timeout: 15000 }).catch(() => {});

                const episodeList = await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button.mat-raised-button'));
                    return btns.map(b => b.innerText.replace(/[^\d]/g, '').trim()).filter(n => n !== "");
                });

                console.log(`   📦 Found ${episodeList.length} episodes.`);
                
                let movieData = { title: movie.title, url: movie.url, episodes: [] };

                for (let epNum of episodeList) {
                    // تصفير الروابط قبل النقر على الحلقة الجديدة
                    currentM3u8 = "";
                    currentSub = "";

                    // النقر على زر الحلقة
                    await page.evaluate((num) => {
                        const btns = Array.from(document.querySelectorAll('button.mat-raised-button'));
                        const target = btns.find(b => b.innerText.trim() == num || b.innerText.includes(` ${num} `));
                        if (target) {
                            target.scrollIntoView();
                            target.click();
                        }
                    }, epNum);

                    // انتظار التقاط الروابط من الشبكة
                    await new Promise(r => setTimeout(r, 8000));

                    const srtLocalPath = await downloadSub(currentSub, movie.title, epNum);

                    movieData.episodes.push({
                        ep: epNum,
                        video: currentM3u8,
                        sub: currentSub,
                        local_sub: srtLocalPath || ""
                    });
                    console.log(`     - Ep ${epNum}: ${currentM3u8 ? '✅ Video Found' : '❌ No Video'}`);
                }

                results.push(movieData);
                // حفظ مؤقت للبيانات بعد كل مسلسل لضمان عدم ضياعها
                fs.writeFileSync('movies.json', JSON.stringify(results, null, 2));

            } catch (err) {
                console.log(`   ⚠️ Error in ${movie.title}: ${err.message}`);
            }
        }

        console.log(`\n🎉 Process Completed!`);

    } catch (e) {
        console.log(`🔥 Critical Error: ${e.message}`);
    } finally {
        await browser.close();
    }
}

startScraping();
