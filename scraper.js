const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

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
    } catch (error) { return null; }
}

async function startScraping() {
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'] 
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const targetUrl = 'https://kisskh.do/Explore?type=2&order=2';
    console.log(`🚀 Start Scraping: ${targetUrl}`);
    
    try {
        await page.goto(targetUrl, { waitUntil: 'networkidle2' });

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
                // مصفوفة لتخزين روابط الحلقات والترجمات المكتشفة من الشبكة
                let capturedEpisodes = [];

                // تفعيل اعتراض الاستجابات (Response Interception)
                await page.setRequestInterception(true);
                
                const onResponse = async (response) => {
                    const url = response.url();
                    // البحث عن طلب الـ API الذي يحتوي على معلومات الحلقات
                    // عادة يكون الرابط يحتوي على كلمة 'Episode' أو 'info'
                    if (url.includes('/api/Drama/Episode') || url.includes('episode')) {
                        try {
                            const data = await response.json();
                            if (data && data.episodes) {
                                capturedEpisodes = data.episodes; 
                            }
                        } catch (e) {}
                    }
                };

                page.on('request', req => req.continue());
                page.on('response', onResponse);

                await page.goto(movie.url, { waitUntil: 'networkidle0', timeout: 60000 });
                
                // انتظار إضافي للتأكد من التقاط طلب الـ API
                await new Promise(r => setTimeout(r, 5000));

                if (capturedEpisodes.length === 0) {
                    console.log(`   ⚠️ Network sniffing failed for episodes. Trying fallback...`);
                    // إذا فشل الـ API، نحاول استخراجها من أزرار الصفحة كخطة بديلة
                    capturedEpisodes = await page.evaluate(() => {
                        const btns = Array.from(document.querySelectorAll('button.mat-raised-button'));
                        return btns.map(b => ({ number: b.innerText.replace(/[^\d]/g, '').trim() }))
                                   .filter(b => b.number !== "");
                    });
                }

                console.log(`   📦 Found ${capturedEpisodes.length} episodes.`);
                
                let movieData = { title: movie.title, url: movie.url, episodes: [] };

                for (let ep of capturedEpisodes) {
                    const epNum = ep.number || ep;
                    let currentM3u8 = "";
                    let currentSub = "";

                    // وظيفة التقاط روابط الفيديو والترجمة عند النقر
                    const captureMedia = (request) => {
                        const reqUrl = request.url();
                        if (reqUrl.includes('.m3u8')) currentM3u8 = reqUrl;
                        if (reqUrl.includes('.srt')) currentSub = reqUrl;
                        request.continue();
                    };

                    page.removeAllListeners('request');
                    await page.setRequestInterception(true);
                    page.on('request', captureMedia);

                    // النقر على الحلقة
                    await page.evaluate((num) => {
                        const btns = Array.from(document.querySelectorAll('button.mat-raised-button'));
                        const target = btns.find(b => b.innerText.trim() == num || b.innerText.includes(` ${num} `));
                        if (target) target.click();
                    }, epNum);

                    await new Promise(r => setTimeout(r, 6000));

                    movieData.episodes.push({
                        ep: epNum,
                        video: currentM3u8,
                        sub: currentSub
                    });
                    console.log(`     - Ep ${epNum}: Captured`);
                }

                results.push(movieData);
                page.removeListener('response', onResponse);

            } catch (err) {
                console.log(`   ⚠️ Error: ${err.message}`);
            }
        }

        fs.writeFileSync('movies.json', JSON.stringify(results, null, 2));
        console.log(`\n🎉 Success! Check movies.json`);

    } catch (e) {
        console.log(`🔥 Critical Error: ${e.message}`);
    } finally {
        await browser.close();
    }
}

startScraping();
