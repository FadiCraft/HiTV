const { chromium } = require('playwright');
const fs = require('fs');
const axios = require('axios');

async function startScraping() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();
    
    const dataFilePath = 'data.json';
    if (!fs.existsSync('subtitles')) fs.mkdirSync('subtitles');

    // تهيئة ملف JSON إذا لم يكن موجوداً أو كان فارغاً
    if (!fs.existsSync(dataFilePath) || fs.readFileSync(dataFilePath).length === 0) {
        fs.writeFileSync(dataFilePath, JSON.stringify([], null, 2));
    }

    const albumUrl = "https://home.hitv.vip/ar-ae/album/a_MT4IPBbd_619kbg8HYh1g";

    // مراقبة الشبكة لالتقاط الروابط
    page.on('response', async (res) => {
        const url = res.url();
        if (url.includes('.m3u8')) page.latestM3u8 = url;
        if (url.includes('.xml') && url.includes('subtitle')) page.latestSub = url;
    });

    try {
        console.log("🔗 فتح الألبوم...");
        await page.goto(albumUrl, { waitUntil: 'networkidle', timeout: 60000 });

        const seriesLinks = await page.$$eval('.album a', els => els.map(el => el.href));
        console.log(`✅ وجدنا ${seriesLinks.length} مسلسل.`);

        for (const sLink of seriesLinks) {
            console.log(`🎬 جاري معالجة المسلسل: ${sLink}`);
            await page.goto(sLink, { waitUntil: 'domcontentloaded' });
            
            // محاولة إغلاق النوافذ المنبثقة
            try {
                await page.waitForSelector('.van-overlay, .dialogContent', { timeout: 3000 });
                await page.keyboard.press('Escape');
            } catch (e) {}

            const title = (await page.title()).split('-')[0].trim();
            let seriesObject = {
                title: title,
                url: sLink,
                extracted_at: new Date().toISOString(),
                episodes: []
            };

            const episodes = await page.$$('.play-item');
            for (let i = 0; i < episodes.length; i++) {
                console.log(`   📡 استخراج الحلقة ${i + 1}...`);
                page.latestM3u8 = null;
                page.latestSub = null;

                await episodes[i].dispatchEvent('click');
                await page.waitForTimeout(4000); // انتظار تحميل الروابط من الشبكة

                seriesObject.episodes.push({
                    episode: i + 1,
                    m3u8: page.latestM3u8 || "N/A",
                    subtitle: page.latestSub || "N/A"
                });
            }

            // --- الجزء الخاص بالحفظ الفوري للمسلسل الحالي ---
            try {
                // 1. قراءة البيانات الحالية من الملف
                const currentFileContent = fs.readFileSync(dataFilePath, 'utf-8');
                let currentArray = JSON.parse(currentFileContent);
                
                // 2. إضافة المسلسل الجديد للمصفوفة
                currentArray.push(seriesObject);
                
                // 3. إعادة كتابة الملف بالكامل بالبيانات المحدثة
                fs.writeFileSync(dataFilePath, JSON.stringify(currentArray, null, 2));
                console.log(`💾 تم حفظ بيانات المسلسل "${title}" في الملف مباشرة.`);
            } catch (saveError) {
                console.error(`❌ فشل الحفظ الفوري للمسلسل: ${title}`, saveError);
            }
        }

        console.log("✨ انتهت عملية الاستخراج والحفظ لجميع المسلسلات.");

    } catch (err) {
        console.error("❌ خطأ عام أثناء التشغيل:", err.message);
    } finally {
        await browser.close();
    }
}

startScraping();
