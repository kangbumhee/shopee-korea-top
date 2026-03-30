// ============================================
// Shopee Korea Top Sales 수집기
// node scripts/collect.mjs [sg|my|th|ph|tw|vn|br|mx|all]
// ============================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// 국가별 설정
const COUNTRIES = {
  sg: { domain: 'shopee.sg', currency: 'SGD', name: 'Singapore', priceDivisor: 100000 },
  my: { domain: 'shopee.com.my', currency: 'MYR', name: 'Malaysia', priceDivisor: 100000 },
  th: { domain: 'shopee.co.th', currency: 'THB', name: 'Thailand', priceDivisor: 100000 },
  ph: { domain: 'shopee.ph', currency: 'PHP', name: 'Philippines', priceDivisor: 100000 },
  tw: { domain: 'shopee.tw', currency: 'TWD', name: 'Taiwan', priceDivisor: 100000 },
  vn: { domain: 'shopee.vn', currency: 'VND', name: 'Vietnam', priceDivisor: 100000 },
  br: { domain: 'shopee.com.br', currency: 'BRL', name: 'Brazil', priceDivisor: 100000 },
  mx: { domain: 'shopee.com.mx', currency: 'MXN', name: 'Mexico', priceDivisor: 100000 },
};

// 가능한 Korea 필터 파라미터 (나라마다 다를 수 있음)
const KOREA_FILTERS = ['locations=Korea', 'locations=KR', 'shippingOrigins=Korea'];

const PARALLEL = 15;
const PAGES_PER_CAT = 9;
const DELAY = 150;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retries) return null;
      await sleep(1000 * (i + 1));
    }
  }
  return null;
}

// Korea 필터 파라미터 탐지
async function detectKoreaFilter(domain) {
  const catData = await fetchJSON(`https://${domain}/api/v4/pages/get_category_tree`);
  const cats = catData?.data?.category_list || [];
  if (!cats.length) return { filter: null, cats: [] };

  const testCat = cats[0].catid;

  for (const filter of KOREA_FILTERS) {
    const url = `https://${domain}/api/v4/search/search_items?by=sales&limit=5&${filter}&match_id=${testCat}&newest=0&order=desc&page_type=search&scenario=PAGE_CATEGORY&version=2`;
    const data = await fetchJSON(url);
    const items = data?.items || [];
    if (items.length > 0) {
      const loc = (items[0].item_basic || items[0]).shop_location || '';
      if (loc.toLowerCase().includes('korea') || loc.toLowerCase().includes('kr')) {
        console.log(`  ✅ ${domain}: "${filter}" 동작 (${loc})`);
        return { filter, cats };
      }
    }
    await sleep(300);
  }

  console.log(`  ⚠️ ${domain}: Korea 필터 없음`);
  return { filter: null, cats };
}

// 카테고리 트리 구성
function buildCategoryTree(cats) {
  const tree = {};
  const bigCats = [];
  const midCats = [];

  for (const c of cats) {
    const cname = c.display_name || c.name || '';
    tree[c.catid] = cname;
    bigCats.push({ id: c.catid, name: cname });
    for (const s of (c.children || [])) {
      const sname = s.display_name || s.name || '';
      tree[s.catid] = sname;
      midCats.push({ id: s.catid, name: sname, parent: cname, parentId: c.catid });
      for (const g of (s.children || [])) {
        tree[g.catid] = g.display_name || g.name || '';
      }
    }
  }

  return { tree, bigCats, midCats };
}

// 수집 대상 카테고리 결정 (500 상한 분할)
async function determineScanCats(domain, filter, bigCats, midCats) {
  const scanCats = [];
  const checks = [];

  // 병렬로 대분류별 건수 확인
  for (let i = 0; i < bigCats.length; i += PARALLEL) {
    const batch = bigCats.slice(i, i + PARALLEL);
    const results = await Promise.all(batch.map(async (cat) => {
      const url = `https://${domain}/api/v4/search/search_items?by=sales&limit=1&${filter}&match_id=${cat.id}&newest=0&order=desc&page_type=search&scenario=PAGE_CATEGORY&version=2`;
      const data = await fetchJSON(url);
      return { cat, total: data?.total_count || 0 };
    }));
    checks.push(...results);
    await sleep(DELAY);
  }

  for (const { cat, total } of checks) {
    if (total === 0) continue;
    if (total >= 500) {
      const subs = midCats.filter(m => m.parentId === cat.id);
      subs.forEach(s => scanCats.push({ id: s.id, name: s.name, parent: cat.name }));
      console.log(`    ${cat.name}: ${total}(상한) → ${subs.length}개 중분류`);
    } else {
      scanCats.push({ id: cat.id, name: cat.name, parent: '' });
      console.log(`    ${cat.name}: ${total}`);
    }
  }

  return scanCats;
}

// 상품 수집
async function collectProducts(domain, filter, scanCats, catTree, priceDivisor) {
  const pMap = {};
  const skipCats = {};
  let calls = 0;

  // 전체 태스크 목록
  const tasks = [];
  for (const cat of scanCats) {
    for (let pg = 0; pg < PAGES_PER_CAT; pg++) {
      tasks.push({ ...cat, page: pg });
    }
  }

  // 병렬 실행
  for (let i = 0; i < tasks.length; i += PARALLEL) {
    const batch = tasks.slice(i, i + PARALLEL).filter(t => !skipCats[t.id]);
    if (!batch.length) continue;

    const results = await Promise.all(batch.map(async (task) => {
      const url = `https://${domain}/api/v4/search/search_items?by=sales&limit=60&${filter}&match_id=${task.id}&newest=${task.page * 60}&order=desc&page_type=search&scenario=PAGE_CATEGORY&version=2`;
      const data = await fetchJSON(url);
      calls++;
      const items = data?.items || [];

      for (const entry of items) {
        const it = entry.item_basic || entry;
        if (pMap[it.itemid]) continue;
        pMap[it.itemid] = {
          id: it.itemid, sid: it.shopid, nm: it.name || '', img: it.image || '',
          pr: it.price ? it.price / priceDivisor : 0,
          pMin: it.price_min ? it.price_min / priceDivisor : 0,
          pMax: it.price_max ? it.price_max / priceDivisor : 0,
          pOld: it.price_before_discount ? it.price_before_discount / priceDivisor : 0,
          disc: it.discount || '',
          sold: it.sold || 0, hist: it.historical_sold || 0,
          like: it.liked_count || 0,
          rate: it.item_rating?.rating_star || 0,
          rv: it.cmt_count || 0,
          sn: it.shop_name || '', sl: it.shop_location || '',
          off: it.is_official_shop || false, pref: it.is_preferred_plus_seller || false,
          cat: catTree[it.catid] || task.name,
          catBig: task.parent || task.name,
          catId: it.catid || 0,
        };
      }

      return { catId: task.id, count: items.length, nomore: data?.nomore || items.length < 60 };
    }));

    for (const r of results) {
      if (r.count === 0 || r.nomore) skipCats[r.catId] = true;
    }

    if ((i / PARALLEL) % 20 === 0) {
      console.log(`    진행: ${Math.min(i + PARALLEL, tasks.length)}/${tasks.length} | 상품 ${Object.keys(pMap).length} | API ${calls}`);
    }

    await sleep(DELAY);
  }

  return { products: Object.values(pMap).sort((a, b) => b.sold - a.sold), calls };
}

// 한 나라 수집
async function collectCountry(code) {
  const config = COUNTRIES[code];
  if (!config) { console.log(`❌ 알 수 없는 나라: ${code}`); return; }

  console.log(`\n🇰🇷 ${config.name} (${config.domain}) 수집 시작...`);
  const startTime = Date.now();

  // 1. Korea 필터 탐지
  const { filter, cats } = await detectKoreaFilter(config.domain);
  if (!filter) {
    console.log(`  ⏭️ ${config.name}: Korea 필터 미지원, 건너뜀`);
    // 빈 파일 저장
    const emptyData = { meta: { country: code, name: config.name, supported: false, collected: new Date().toISOString() }, products: [] };
    fs.writeFileSync(path.join(DATA_DIR, `${code}.json`), JSON.stringify(emptyData));
    return;
  }

  // 2. 카테고리 구성
  const { tree, bigCats, midCats } = buildCategoryTree(cats);
  console.log(`  📂 대분류 ${bigCats.length}개, 중분류 ${midCats.length}개`);

  // 3. 수집 대상 결정
  const scanCats = await determineScanCats(config.domain, filter, bigCats, midCats);
  console.log(`  📋 수집 대상: ${scanCats.length}개 카테고리`);

  // 4. 상품 수집
  const { products, calls } = await collectProducts(config.domain, filter, scanCats, tree, config.priceDivisor);
  const sellers = new Set(products.map(p => p.sid)).size;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`  ✅ ${config.name}: ${products.length}개 상품, ${sellers}셀러, API ${calls}회, ${elapsed}초`);

  // 5. 카테고리 집계
  const catBigCount = {};
  const catMidCount = {};
  products.forEach(p => {
    catBigCount[p.catBig] = (catBigCount[p.catBig] || 0) + 1;
    catMidCount[p.cat] = (catMidCount[p.cat] || 0) + 1;
  });

  // 6. JSON 저장
  const output = {
    meta: {
      country: code,
      name: config.name,
      domain: config.domain,
      currency: config.currency,
      supported: true,
      filter,
      collected: new Date().toISOString(),
      totalProducts: products.length,
      totalSellers: sellers,
      apiCalls: calls,
      elapsedSeconds: parseFloat(elapsed),
      categories: {
        big: Object.entries(catBigCount).sort((a, b) => b[1] - a[1]),
        mid: Object.entries(catMidCount).sort((a, b) => b[1] - a[1]),
      },
    },
    products,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${code}.json`), JSON.stringify(output));
  console.log(`  📁 저장: public/data/${code}.json (${(JSON.stringify(output).length / 1024 / 1024).toFixed(1)}MB)`);
}

// 메인
async function main() {
  const arg = process.argv[2] || 'all';
  const targets = arg === 'all' ? Object.keys(COUNTRIES) : arg.split(',');

  console.log('🌏 Shopee Korea Top Sales 수집기');
  console.log('대상:', targets.join(', '));
  console.log('시작:', new Date().toISOString());

  for (const code of targets) {
    await collectCountry(code.trim());
  }

  // 전체 인덱스 생성
  const index = {};
  for (const code of Object.keys(COUNTRIES)) {
    const filePath = path.join(DATA_DIR, `${code}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        index[code] = data.meta;
      } catch (e) {}
    }
  }
  fs.writeFileSync(path.join(DATA_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log('\n📁 인덱스 저장: public/data/index.json');
  console.log('🏁 완료:', new Date().toISOString());
}

main().catch(console.error);
