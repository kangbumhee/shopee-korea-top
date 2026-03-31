import puppeteer from 'puppeteer';

async function test() {
  console.log('🔗 기존 Chrome에 연결...');
  
  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null
    });
  } catch(e) {
    console.log('❌ Chrome 연결 실패. Chrome이 --remote-debugging-port=9222로 실행중인지 확인하세요.');
    console.log(e.message);
    process.exit(1);
  }

  console.log('✅ Chrome 연결 성공!');
  
  const page = await browser.newPage();
  
  console.log('📄 shopee.sg 방문...');
  await page.goto('https://shopee.sg', { waitUntil: 'networkidle2', timeout: 30000 });
  
  // 로그인 상태 확인
  const loginCheck = await page.evaluate(() => {
    return {
      cookie: document.cookie.includes('SPC_U='),
      cookieLen: document.cookie.length
    };
  });
  console.log('로그인:', loginCheck.cookie ? '✅' : '❌');

  // API 호출
  console.log('🔍 API 테스트...');
  const result = await page.evaluate(async () => {
    try {
      const res = await fetch('/api/v4/search/search_items?by=sales&limit=5&locations=Korea&match_id=11012070&newest=0&order=desc&page_type=search&scenario=PAGE_CATEGORY&version=2', { credentials: 'include' });
      const data = await res.json();
      return {
        total: data.total_count || 0,
        items: (data.items || []).length,
        first: data.items?.[0] ? {
          name: (data.items[0].item_basic || data.items[0]).name?.substring(0, 50),
          sold: (data.items[0].item_basic || data.items[0]).sold
        } : null,
        error: data.error || null
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  console.log('');
  console.log('══ 결과 ══');
  console.log('total:', result.total);
  console.log('items:', result.items);
  if (result.first) console.log('1위:', result.first.name, '| sold:', result.first.sold);
  if (result.error) console.log('에러:', result.error);
  console.log(result.items > 0 ? '✅ 성공! CDP 방식 작동!' : '❌ 실패');

  await page.close();
  browser.disconnect(); // close 대신 disconnect (기존 Chrome 유지)
}

test().catch(e => { console.error(e.message); process.exit(1); });