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
    // مهم جداً لمحاكاة متصفح حقيقي وتجنب الحظر
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const targetUrl = 'https://kisskh.do/Explore?type=2&order=2';
    console.log(`🚀 Start: ${targetUrl}`);
    
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
            console.log(`\n🔍 Checking: ${movie.title}`);
            
            try {
                // الذهاب لصفحة المسلسل والانتظار حتى يستقر الشبكة
                await page.goto(movie.url, { waitUntil: 'networkidle0', timeout: 60000 });
                
                // انتظار تحميل أزرار الحلقات (تغيير الـ Selector ليكون أكثر شمولاً)
                await page.waitForFunction(() => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    return btns.some(b => b.innerText.includes('1') || b.innerText.includes('2'));
                }, { timeout: 15000 }).catch(() => console.log("      ⚠️ Timeout waiting for buttons"));

                const episodeList = await page.evaluate(() => {
                    // البحث عن كل الأزرار التي تحتوي على أرقام فقط (أو رقم مع أيقونة)
                    const buttons = Array.from(document.querySelectorAll('button.mat-raised-button'));
                    return buttons
                        .map(btn => btn.innerText.replace(/[^\d]/g, '').trim())
                        .filter(txt => txt.length > 0 && !isNaN(txt))
                        .reverse(); // لترتيبها من الحلقة 1 صعوداً
                });

                if (episodeList.length === 0) {
                    console.log(`   ❌ No episodes found. Link might be different.`);
                    continue;
                }

                console.log(`   📦 Found ${episodeList.length} episodes.`);
                
                let movieData = { title: movie.title, url: movie.url, episodes: [] };

                for (let epNum of episodeList) {
                    let currentM3u8 = "";
                    let currentSub = "";

                    await page.setRequestInterception(true);
                    const onReq = (request) => {
                        const url = request.url();
                        if (url.includes('.m3u8')) currentM3u8 = url;
                        if (url.includes('.srt')) currentSub = url;
                        request.continue();
                    };
                    page.on('request', onReq);

                    // النقر البرمجي الدقيق
                    await page.evaluate((num) => {
                        const btns = Array.from(document.querySelectorAll('button.mat-raised-button'));
                        const target = btns.find(b => b.innerText.trim().startsWith(num) || b.innerText.trim().endsWith(num));
                        if (target) {
                            target.scrollIntoView();
                            target.click();
                        }
                    }, epNum);

                    await new Promise(r => setTimeout(r, 6000)); // انتظار الرابط

                    movieData.episodes.push({
                        ep: epNum,
                        video: currentM3u8,
                        sub: currentSub
                    });

                    await page.setRequestInterception(false);
                    page.removeListener('request', onReq);
                    console.log(`     - Ep ${epNum}: Captured`);
                }
                results.push(movieData);

            } catch (err) {
                console.log(`   ⚠️ Error: ${err.message}`);
            }
        }

        fs.writeFileSync('movies.json', JSON.stringify(results, null, 2));
        console.log(`\n🎉 Done! Data saved.`);

    } catch (e) {
        console.log(`🔥 Critical: ${e.message}`);
    } finally {
        await browser.close();
    }
}

startScraping();
