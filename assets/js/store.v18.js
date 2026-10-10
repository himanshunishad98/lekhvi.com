(function () {
  'use strict';

  const CFG = window.LEKHVI_CONFIG || {};
  const hasSupabase = !!(window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_PUBLISHABLE_KEY);
  const sb = hasSupabase
    ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;
  const $ = (id) => document.getElementById(id);
  const toPriceNumber = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const cleaned = value.replace(/[^0-9.\-]/g, '');
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };
  const money = (n) => '₹' + toPriceNumber(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

  // Product price is the authoritative price for the PDP. A variant price is
  // used only when it is a real positive value; null/empty/0 legacy variant
  // prices always fall back to the product's Supabase price.
  const safePrice = (value, fallback = 0) => {
    const n = toPriceNumber(value);
    if (n > 0) return n;
    const fb = toPriceNumber(fallback);
    return fb > 0 ? fb : 0;
  };
  const productBasePrice = (product) => safePrice(product?.price);
  const displayPrice = (product, variant) => safePrice(variant?.price, productBasePrice(product));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));

  // Render product descriptions entered as plain text/Markdown while preserving
  // paragraphs, line breaks, headings, bullets and inline emphasis. Raw HTML is
  // always escaped first, so product content cannot inject arbitrary markup.
  function descriptionInline(value) {
    return escapeHtml(value)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  }

  function formatDescription(value) {
    let raw = String(value ?? '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return '';

    // Legacy product copy often has uppercase section labels in one pasted line.
    // Split before those labels so they read as distinct sections even if the
    // original source pasted without line breaks.
    raw = raw.replace(/(^|\s)([A-Z][A-Z0-9&/()'’–— -]{3,}:)(?=\s)/g,
      (_match, lead, label) => `${lead}\n${label}`);

    const lines = raw.split('\n');
    const output = [];
    let paragraph = [];
    let listItems = [];
    let listType = '';

    const flushParagraph = () => {
      if (!paragraph.length) return;
      output.push(`<p>${paragraph.map(line => descriptionInline(line)).join('<br>')}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (!listItems.length) return;
      const tag = listType === 'ol' ? 'ol' : 'ul';
      output.push(`<${tag}>${listItems.map(item => `<li>${descriptionInline(item)}</li>`).join('')}</${tag}>`);
      listItems = [];
      listType = '';
    };
    const flushText = () => { flushParagraph(); flushList(); };

    for (const sourceLine of lines) {
      const line = sourceLine.trim();
      if (!line) { flushText(); continue; }

      const markdownHeading = line.match(/^(#{1,3})\s+(.+)$/);
      if (markdownHeading) {
        flushText();
        const level = Math.min(5, markdownHeading[1].length + 2);
        output.push(`<h${level}>${descriptionInline(markdownHeading[2])}</h${level}>`);
        continue;
      }

      const unordered = line.match(/^(?:[-*•])\s+(.+)$/);
      const ordered = line.match(/^\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        const nextType = ordered ? 'ol' : 'ul';
        if (listItems.length && listType !== nextType) flushList();
        listType = nextType;
        listItems.push((unordered || ordered)[1]);
        continue;
      }

      flushList();
      // Turn uppercase labels (e.g. “PACKAGE CONTENTS:”) into clear section leads.
      const label = line.match(/^([A-Z][A-Z0-9&/()'’–— -]{3,}:)(?:\s*)(.*)$/);
      if (label) {
        flushParagraph();
        output.push(`<p class="descriptionSection"><strong>${descriptionInline(label[1])}</strong>${label[2] ? ` ${descriptionInline(label[2])}` : ''}</p>`);
        continue;
      }
      paragraph.push(line);
    }
    flushText();
    return output.join('\n');
  }
  const PLACEHOLDER = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450"><rect width="600" height="450" fill="#f4f7f5"/><text x="300" y="220" text-anchor="middle" font-family="Arial" font-size="24" fill="#6b756e">Lekhvi</text></svg>');
  const CART_KEY = 'lekhvi_cart_v10';
  const PER_PAGE = 24;

  let products = [];
  let collections = [];
  let heroes = [];
  let settings = {};
  let currentCategory = 'All';
  let currentPage = 1;
  let searchIndex = -1;
  let selectedProduct = null;
  let selectedVariant = null;

  function dbProduct(x) {
    return {
      id: Number(x.id), sku: x.sku || '', name: x.name || '', collection: x.collection || '', subcategory: x.subcategory || '',
      ageRange: x.age_range || '', classRange: x.class_range || '', language: x.language || '', format: x.format || '',
      shortDescription: x.short_description || '', description: x.description || '', price: toPriceNumber(x.price), compareAt: toPriceNumber(x.compare_at),
      stock: toPriceNumber(x.stock), published: !!x.published, featured: !!x.featured, rating: Number(x.rating || 0), tags: Array.isArray(x.tags) ? x.tags : [],
      whatYouGet: Array.isArray(x.what_you_get) ? x.what_you_get : [], features: x.features && typeof x.features === 'object' ? x.features : {},
      variants: Array.isArray(x.variants) && x.variants.length ? x.variants.map(v => ({
        ...v,
        price: safePrice(v?.price, x.price)
      })) : [{ name: x.format || 'Printed Spiral Book', price: safePrice(x.price), delivery: 'Physical delivery' }],
      images: Array.isArray(x.images) ? x.images.filter(Boolean) : [], sampleCaption: x.sample_caption || '', purpose: x.purpose || '', updatedAt: x.updated_at || ''
    };
  }

  async function fetchAll(table, queryBuilder) {
    const rows = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
      let q = queryBuilder(sb.from(table));
      const { data, error } = await q.range(from, from + size - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < size) break;
    }
    return rows;
  }

  async function loadSettings() {
    const { data, error } = await sb.from('site_settings').select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    settings = data || {};
    applySettings();
  }

  async function loadCollections() {
    const { data, error } = await sb.from('collections').select('*').eq('active', true).order('sort_order', { ascending: true });
    if (error) throw error;
    collections = data || [];
    renderCollections();
    renderNavigation();
  }

  async function loadHeroes() {
    const { data, error } = await sb.from('hero_offers').select('*').eq('active', true).order('sort_order', { ascending: true }).order('id', { ascending: true });
    if (error) throw error;
    heroes = data || [];
    const ids = heroes.map(h => Number(h.product_id)).filter(Boolean);
    if (ids.length) {
      const { data: ps, error: pe } = await sb.from('products').select('id,name,price,compare_at,published,stock,images').in('id', ids);
      if (pe) throw pe;
      const byId = new Map((ps || []).map(p => [Number(p.id), p]));
      heroes = heroes.map(h => ({ ...h, product: byId.get(Number(h.product_id)) || null }));
    }
    renderHero();
  }

  async function loadProductCount() {
    const { count, error } = await sb.from('products').select('id', { count: 'exact', head: true });
    if (error) throw error;
    $('productCount').textContent = Number(count || 0).toLocaleString('en-IN');
  }

  async function loadProducts() {
    const rows = await fetchAll('products', (q) => q.select('*').eq('published', true).order('id', { ascending: true }));
    products = rows.map(dbProduct);
    buildFilterOptions();
    render();
  }

  function applySettings() {
    const name = settings.store_name || 'Lekhvi.com';
    $('brandName').textContent = name;
    $('footerName').textContent = name;
    if (settings.store_tagline) $('brandTag').textContent = settings.store_tagline;
    const logo = $('siteLogo');
    const initial = $('brandInitial');
    if (settings.logo_url) {
      logo.src = settings.logo_url;
      logo.classList.remove('hidden');
      initial.classList.add('hidden');
    } else {
      logo.removeAttribute('src');
      logo.classList.add('hidden');
      initial.classList.remove('hidden');
      initial.textContent = name.trim().charAt(0).toUpperCase() || 'L';
    }
    const favicon = $('siteFavicon');
    favicon.href = settings.favicon_url || favicon.href;
    if (settings.whatsapp_number) $('whatsappBtn').dataset.number = normalizeWhatsApp(settings.whatsapp_number);
  }

  function normalizeWhatsApp(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 10) digits = '91' + digits;
    return digits;
  }

  function renderNavigation() {
    $('navLinks').innerHTML = collections.slice(0, 5).map((c) => `<a href="#shop" data-collection-link="${escapeHtml(c.name)}">${escapeHtml(c.name)}</a>`).join('');
    $('footerCollections').innerHTML = collections.map((c) => `<a href="#shop" data-collection-link="${escapeHtml(c.name)}">${escapeHtml(c.name)}</a>`).join('');
  }

  function renderCollections() {
    if (!collections.length) {
      $('collectionsGrid').innerHTML = '<div class="empty">No active collections are configured yet. Add collections in Supabase.</div>';
      return;
    }
    const counts = new Map();
    products.forEach((p) => counts.set(p.collection, (counts.get(p.collection) || 0) + 1));
    $('collectionsGrid').innerHTML = collections.map((c) => `
      <a class="collection" href="#shop" data-collection-link="${escapeHtml(c.name)}">
        <div class="collectionEmoji">${escapeHtml(c.emoji || '📚')}</div>
        <h3>${escapeHtml(c.name)}</h3>
        <small>${escapeHtml(c.description || '')}</small><br>
        <small>${counts.get(c.name) || 0} products</small>
      </a>`).join('');
  }

  function renderHero() {
    const visual = $('heroVisual');
    if (!heroes.length) {
      visual.innerHTML = '<div class="heroVisualEmpty"><div><strong>Offers appear here</strong><span>Create and publish a hero offer from the Admin Panel → Hero Offers.</span></div></div>';
      return;
    }
    const h = heroes[0];
    $('heroText').innerHTML = `
      <span class="eyebrow">${escapeHtml(h.eyebrow || 'LEKHVI.COM')}</span>
      <h1>${escapeHtml(h.title || 'Learning resources for everyday growth.').replace(/\.$/, '')}</h1>
      <p>${escapeHtml(h.description || '')}</p>
      <div class="heroCtas">
        <a class="btn btnPrimary" href="${escapeHtml(h.cta_link || '#shop')}">${escapeHtml(h.cta_text || 'Browse catalogue')}</a>
        <a class="btn btnSecondary" href="#collections">Shop by collection</a>
      </div>
      <div class="heroMeta"><span>✓ <strong id="productCount">0</strong> products in catalogue</span><span>✓ Live from Supabase</span><span class="heroProductPrice" ${h.product?'':'hidden'}>${h.product ? `${money(h.product.price)}${h.product.compare_at ? ` <del>${money(h.product.compare_at)}</del>` : ''}` : ''}</span><span>${h.badge ? '✓ ' + escapeHtml(h.badge) : '✓ Independent storefront'}</span></div>`;
    // Product count node is replaced by the hero template, so refresh it after hero render.
    loadProductCount().catch(() => {});
    const img = h.image_url ? `<img src="${escapeHtml(h.image_url)}" alt="${escapeHtml(h.title || 'Lekhvi offer')}" loading="eager">` : '<div class="heroVisualEmpty"><div><strong>No offer image</strong><span>Add an image from the Admin Panel if needed.</span></div></div>';
    const dots = heroes.length > 1 ? `<div class="heroDots">${heroes.map((_,i)=>`<button class="heroDot ${i===0?'active':''}" data-hero-index="${i}" aria-label="Show offer ${i+1}"></button>`).join('')}</div>` : '';
    visual.innerHTML = img + dots;
    if (heroes.length > 1) setupHeroRotator();
  }

  let heroTimer = null;
  function setupHeroRotator() {
    if (heroTimer) clearInterval(heroTimer);
    let i = 0;
    heroTimer = setInterval(() => { i = (i + 1) % heroes.length; showHero(i); }, 6000);
  }
  function showHero(i) {
    const h = heroes[i]; if (!h) return;
    const visual = $('heroVisual');
    const dots = heroes.map((_,idx)=>`<button class="heroDot ${idx===i?'active':''}" data-hero-index="${idx}" aria-label="Show offer ${idx+1}"></button>`).join('');
    visual.innerHTML = (h.image_url ? `<img src="${escapeHtml(h.image_url)}" alt="${escapeHtml(h.title || 'Lekhvi offer')}">` : '<div class="heroVisualEmpty"><div><strong>No offer image</strong><span>Add an image from the Admin Panel if needed.</span></div></div>') + (heroes.length > 1 ? `<div class="heroDots">${dots}</div>` : '');
    const text = $('heroText');
    text.querySelector('.eyebrow').textContent = h.eyebrow || 'LEKHVI.COM';
    text.querySelector('h1').textContent = h.title || 'Learning resources for everyday growth';
    text.querySelector('p').textContent = h.description || '';
    const priceNode = text.querySelector('.heroProductPrice');
    if (priceNode) { priceNode.classList.toggle('hidden', !h.product); priceNode.innerHTML = h.product ? money(h.product.price) + (h.product.compare_at ? ` <del>${money(h.product.compare_at)}</del>` : '') : ''; }
    const cta = text.querySelector('.btnPrimary');
    cta.textContent = h.cta_text || 'Browse catalogue'; cta.href = h.cta_link || '#shop';
    const strong = $('productCount'); if (strong) strong.textContent = products.length.toLocaleString('en-IN');
  }

  function buildFilterOptions() {
    const unique = (arr) => [...new Set(arr.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b)));
    const ages = unique(products.map(p => p.ageRange || p.classRange));
    $('age').innerHTML = '<option>All ages</option>' + ages.map(x=>`<option>${escapeHtml(x)}</option>`).join('');
    const langs = unique(products.map(p => p.language));
    $('lang').innerHTML = '<option>All languages</option>' + langs.map(x=>`<option>${escapeHtml(x)}</option>`).join('');
    const formats = unique(products.map(p => p.format));
    $('format').innerHTML = '<option>All formats</option>' + formats.map(x=>`<option>${escapeHtml(x)}</option>`).join('');
    $('collectionFilters').innerHTML = '<button class="filter active" data-collection="All" type="button">All</button>' + collections.map(c=>`<button class="filter" data-collection="${escapeHtml(c.name)}" type="button">${escapeHtml(c.name.replace(/ \(.*?\)$/,''))}</button>`).join('');
  }

  function productMatches(p, q) {
    if (!q) return true;
    const aliases = { maths:'math', planners:'planner', labels:'label', stickers:'sticker', worksheets:'worksheet', books:'book' };
    const terms = String(q).toLowerCase().trim().split(/\s+/).filter(Boolean);
    const hay = [p.name,p.sku,p.description,p.shortDescription,p.subcategory,p.collection,p.ageRange,p.classRange,p.language,p.format,p.purpose,...p.tags,...p.whatYouGet,...Object.values(p.features || {})].join(' ').toLowerCase();
    return terms.every(t => hay.includes(t) || hay.includes(aliases[t] || t));
  }

  function filteredProducts() {
    const q = $('search').value.trim();
    const age = $('age').value; const lang = $('lang').value; const fmt = $('format').value; const sort = $('sort').value;
    let list = products.filter(p => p.published && p.stock > 0 && (currentCategory === 'All' || p.collection === currentCategory) && (age === 'All ages' || (p.ageRange || p.classRange) === age) && (lang === 'All languages' || p.language === lang) && (fmt === 'All formats' || p.format === fmt) && productMatches(p, q));
    if(sort === 'priceLow') list.sort((a,b)=>a.price-b.price);
    else if(sort === 'priceHigh') list.sort((a,b)=>b.price-a.price);
    else if(sort === 'name') list.sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    else list.sort((a,b)=>Number(b.featured)-Number(a.featured) || Number(a.id)-Number(b.id));
    return list;
  }

  function card(p) {
    const src = p.images?.[0] || PLACEHOLDER;
    const productPrice = productBasePrice(p);
    return `<article class="product">
      <div class="badge">${p.stock < 5 ? 'Low stock' : escapeHtml(p.collection || 'Lekhvi')}</div>
      <div class="pimg"><img src="${escapeHtml(src)}" alt="${escapeHtml(p.name)}" loading="lazy"></div>
      <div class="productBody">
        <span class="tag">${escapeHtml(p.subcategory || p.format || 'Product')}</span>
        <small>${escapeHtml(p.ageRange || p.classRange || '')} ${p.language ? '· '+escapeHtml(p.language) : ''}</small>
        <h3>${escapeHtml(p.name)}</h3>
        <p>${escapeHtml(p.shortDescription || p.description || '')}</p>
        <div class="priceRow"><div class="price"><strong>${money(productPrice)}</strong>${p.compareAt ? ` <del>${money(p.compareAt)}</del>`:''}</div><button class="btn btnPrimary tiny" type="button" data-view-product="${p.id}">View</button></div>
      </div>
    </article>`;
  }

  function render() {
    const list = filteredProducts();
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if(currentPage > pages) currentPage = pages;
    const start = (currentPage - 1) * PER_PAGE;
    const shown = list.slice(start, start + PER_PAGE);
    $('productGrid').innerHTML = shown.length ? shown.map(card).join('') : '<div class="empty">No products match the current search or filters.</div>';
    $('filterCount').textContent = `${list.length.toLocaleString('en-IN')} matching`;
    $('catalogSub').textContent = `${products.length.toLocaleString('en-IN')} published products loaded directly from Supabase.`;
    renderPager(pages);
  }

  function renderPager(pages) {
    if(pages <= 1){ $('pager').innerHTML=''; return; }
    const buttons = [];
    for(let i=1;i<=pages;i++) if(i===1 || i===pages || Math.abs(i-currentPage)<=2) buttons.push(`<button type="button" class="pageBtn ${i===currentPage?'active':''}" data-page="${i}">${i}</button>`);
    $('pager').innerHTML = buttons.join('');
  }

  async function openProduct(id) {
    $('pdp').innerHTML = '<div class="loading">Loading product details from Supabase…</div>';
    document.querySelector('#productPreview').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const { data, error } = await sb.from('products').select('*').eq('id', id).eq('published', true).single();
    if(error){ toast(error.message); $('pdp').innerHTML='<div class="empty">Unable to load this product.</div>'; return; }
    selectedProduct = dbProduct(data);
    // Use the exact live products.price value from Supabase as the PDP base price.
    selectedProduct.price = productBasePrice(data);
    const firstVariant = selectedProduct.variants[0];
    selectedVariant = firstVariant
      ? { ...firstVariant, price: displayPrice(selectedProduct, firstVariant) }
      : { name: selectedProduct.format || 'Product', price: selectedProduct.price, delivery: 'Physical delivery' };
    renderPdp();
  }

  function renderPdp() {
    const p = selectedProduct; if(!p) return;
    const images = p.images?.length ? p.images : [PLACEHOLDER];
    $('pdp').innerHTML = `
      <div class="gallery"><div class="thumbs">${images.map((src,i)=>`<button type="button" data-thumb="${i}"><img src="${escapeHtml(src)}" alt="Sample ${i+1}"></button>`).join('')}</div><div class="mainpic"><img id="mainPic" src="${escapeHtml(images[0])}" alt="${escapeHtml(p.name)} sample preview"></div></div>
      <div><span class="tag">${escapeHtml((p.collection || '').toUpperCase())}</span><h2>${escapeHtml(p.name)}</h2><div class="stars">★★★★★ <span class="ratingMeta">${p.rating ? p.rating : '—'}</span></div>
      <div class="chips">${[p.subcategory,p.ageRange||p.classRange,p.language,p.format].filter(Boolean).map(x=>`<span class="chip">${escapeHtml(x)}</span>`).join('')}</div>
      <div class="descriptionContent">${formatDescription(p.description || p.shortDescription || '')}</div>
      <div class="basePrice">Current product price <strong>${money(productBasePrice(p))}</strong></div>
      <div class="toggle">${(p.variants||[]).map((v,i)=>`<button type="button" class="${i===0?'sel':''}" data-variant-index="${i}">${escapeHtml(v.name || p.format || 'Option')} · ${money(displayPrice(p,v))}</button>`).join('')}</div>
      <div class="priceBig" id="pdpPrice">${money(displayPrice(p, selectedVariant))}</div>
      <div class="sampleBox"><strong>Sample preview:</strong> ${escapeHtml(p.sampleCaption || 'Sample images are provided through your Supabase product record.')}</div>
      <div class="infoGrid"><div class="infoCard"><b>What's included</b><div>${p.whatYouGet.length ? p.whatYouGet.map(x=>'• '+escapeHtml(x)).join('<br>') : 'See product description.'}</div></div><div class="infoCard"><b>Buying purpose</b><div>${escapeHtml(p.purpose || 'Learning & productivity')}</div></div></div>
      <div class="ship"><div class="counttext" id="shipText">Add printed products to move toward ₹499 free shipping.</div><div class="bar"><i id="shipBar"></i></div></div>
      <div class="heroCtas"><button class="btn btnPrimary" type="button" id="addProductBtn">Add to cart</button><button class="btn btnSecondary" type="button" data-whatsapp-product="1">Ask on WhatsApp</button></div>
      </div>`;
    updateShippingBar();
    // Safety check: the PDP must never display ₹0 when Supabase provides a
    // positive product price and no positive variant override exists.
    const pdpPrice = displayPrice(p, selectedVariant);
    const priceNode = $('pdpPrice');
    if (priceNode && productBasePrice(p) > 0 && pdpPrice === 0) {
      priceNode.textContent = money(productBasePrice(p));
      selectedVariant = selectedVariant ? { ...selectedVariant, price: productBasePrice(p) } : null;
      console.error('Lekhvi PDP price guard corrected an invalid zero price.', { productId: p.id, productPrice: p.price, variant: selectedVariant });
    }
  }

  function cartItems() { try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; } }
  function saveCart(items){ localStorage.setItem(CART_KEY, JSON.stringify(items)); updateCartUI(); }
  function addToCart(p, variant){
    const items = cartItems();
    const key = `${p.id}:${variant?.name || p.format || 'Product'}`;
    const found = items.find(x => x.key === key);
    const price = displayPrice(p, variant);
    if(found) { found.quantity += 1; found.price = price; }
    else items.push({ key, productId:p.id, name:p.name, variantName:variant?.name || p.format || 'Product', price, image:p.images?.[0]||PLACEHOLDER, quantity:1 });
    saveCart(items); toast('Product added to cart'); openCart();
  }
  function removeCartItem(key){ saveCart(cartItems().filter(x=>x.key!==key)); }
  function updateCartUI(){
    const items = cartItems();
    $('cartCount').textContent = items.reduce((n,i)=>n+Number(i.quantity||0),0);
    const subtotal = items.reduce((n,i)=>n+Number(i.price||0)*Number(i.quantity||0),0);
    $('cartSubtotal').textContent = money(subtotal);
    $('cartItems').innerHTML = items.length ? items.map(i=>`<div class="item"><div class="thumb"><img src="${escapeHtml(i.image)}" alt=""></div><div><h4>${escapeHtml(i.name)}</h4><small>${escapeHtml(i.variantName)} × ${i.quantity}</small><br><small>${money(i.price*i.quantity)}</small><br><button type="button" data-remove-cart="${escapeHtml(i.key)}">Remove</button></div></div>`).join('') : '<div class="empty">Your cart is empty.</div>';
    updateShippingBar();
  }
  function updateShippingBar(){
    const subtotal=cartItems().reduce((n,i)=>n+Number(i.price||0)*Number(i.quantity||0),0);
    const bar=$('shipBar'), text=$('shipText'); if(!bar||!text)return;
    const pct=Math.min(100,(subtotal/499)*100); bar.style.width=pct+'%';
    text.textContent=subtotal>=499?'✓ You have reached the ₹499 free-shipping threshold.':`Add ${money(499-subtotal)} more to move toward ₹499 free shipping.`;
  }
  function openCart(){ $('cartDrawer').classList.add('open'); $('overlay').classList.add('open'); }
  function closeCart(){ $('cartDrawer').classList.remove('open'); if(!$('checkoutModal').classList.contains('open')) $('overlay').classList.remove('open'); }
  function toast(message){ const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),2600); }

  async function submitOrder(e){
    e.preventDefault();
    const items=cartItems(); if(!items.length){toast('Your cart is empty');return;}
    if(!sb){toast('Supabase is not configured');return;}
    const customer={name:$('customerName').value.trim(),mobile:$('customerMobile').value.trim(),email:$('customerEmail').value.trim(),address:$('customerAddress').value.trim(),payment_method:$('paymentMethod').value};
    const payload=items.map(i=>({product_id:i.productId,variant_name:i.variantName,quantity:i.quantity}));
    const btn=e.submitter; btn.disabled=true; btn.textContent='Placing order…';
    try{const {data,error}=await sb.rpc('create_order',{p_customer:customer,p_items:payload});if(error)throw error;toast(`Order ${data.order_number} created`);localStorage.removeItem(CART_KEY);$('checkoutModal').classList.remove('open');$('overlay').classList.remove('open');$('checkoutForm').reset();updateCartUI();await loadProducts();}catch(err){toast(err.message||'Unable to create order');}finally{btn.disabled=false;btn.textContent='Place order request';}
  }

  function searchResults(){
    const input=$('search'), box=$('searchSuggest'); const q=input.value.trim(); searchIndex=-1;
    if(!q){box.classList.remove('open');return;}
    const matches=products.filter(p=>productMatches(p,q)).sort((a,b)=>{const ql=q.toLowerCase(); const an=a.name.toLowerCase(), bn=b.name.toLowerCase(); return (an===ql?0:an.startsWith(ql)?1:2)-(bn===ql?0:bn.startsWith(ql)?1:2)||Number(b.featured)-Number(a.featured);});
    if(!matches.length){box.innerHTML='<div class="searchEmpty">No matching products found.</div>';box.classList.add('open');return;}
    const shown=matches.slice(0,8);
    box.innerHTML='<div class="searchHead"><span>'+matches.length+' matching product'+(matches.length===1?'':'s')+'</span><span>Click to view</span></div>'+shown.map((p,i)=>`<div class="searchItem" role="option" tabindex="0" data-search-product="${p.id}" data-index="${i}"><img src="${escapeHtml(p.images?.[0]||PLACEHOLDER)}" alt=""><div><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.collection)} · ${escapeHtml(p.ageRange||p.classRange||'')} · ${escapeHtml(p.format)}</small></div><div class="searchPrice">${money(p.price)}</div></div>`).join('')+(matches.length>shown.length?'<div class="searchFoot"><button type="button" id="searchAllBtn">View all matching products</button></div>':'');
    box.classList.add('open');
  }

  function selectSearchProduct(id){ $('searchSuggest').classList.remove('open'); openProduct(id); }

  function setCollection(value){ currentCategory=value;currentPage=1;document.querySelectorAll('[data-collection]').forEach(b=>b.classList.toggle('active',b.dataset.collection===value));render();}

  async function boot(){
    if(!sb){ $('productGrid').innerHTML='<div class="empty">Supabase is not configured. Add your project URL and publishable key to supabase-config.js.</div>';return; }
    try{ await Promise.all([loadSettings(),loadCollections(),loadHeroes(),loadProducts(),loadProductCount()]); renderCollections(); updateCartUI(); }
    catch(e){ console.error(e); toast(e.message||'Unable to load Lekhvi data from Supabase'); $('productGrid').innerHTML='<div class="empty">Unable to load products from Supabase. Check the project URL, publishable key and RLS policies.</div>'; }
  }

  document.addEventListener('click', (e) => {
    const heroCta = e.target.closest('.heroCtas .btnPrimary');
    if (heroCta && heroCta.getAttribute('href')?.startsWith('#product-')) { e.preventDefault(); const id = Number(heroCta.getAttribute('href').replace('#product-','')); if (id) openProduct(id); return; }
    const collection = e.target.closest('[data-collection-link]'); if(collection){e.preventDefault();setCollection(collection.dataset.collectionLink);document.querySelector('#shop').scrollIntoView({behavior:'smooth',block:'start'});return;}
    const cb=e.target.closest('[data-collection]'); if(cb){setCollection(cb.dataset.collection);return;}
    const product=e.target.closest('[data-view-product]'); if(product){openProduct(Number(product.dataset.viewProduct));return;}
    const searchItem=e.target.closest('[data-search-product]'); if(searchItem){selectSearchProduct(Number(searchItem.dataset.searchProduct));return;}
    if(e.target.id==='searchAllBtn'){ $('searchSuggest').classList.remove('open');document.querySelector('#shop').scrollIntoView({behavior:'smooth'});currentPage=1;render();return;}
    const page=e.target.closest('[data-page]'); if(page){currentPage=Number(page.dataset.page);render();document.querySelector('#shop').scrollIntoView({behavior:'smooth',block:'start'});return;}
    const thumb=e.target.closest('[data-thumb]'); if(thumb){const i=Number(thumb.dataset.thumb);const src=selectedProduct?.images?.[i]||PLACEHOLDER;const main=$('mainPic');if(main)main.src=src;return;}
    const variant=e.target.closest('[data-variant-index]'); if(variant){const i=Number(variant.dataset.variantIndex);const raw=selectedProduct?.variants?.[i];selectedVariant=raw?{...raw,price:displayPrice(selectedProduct,raw)}:{name:selectedProduct?.format||'Product',price:productBasePrice(selectedProduct)};document.querySelectorAll('[data-variant-index]').forEach(b=>b.classList.toggle('sel',Number(b.dataset.variantIndex)===i));const priceNode=$('pdpPrice');if(priceNode)priceNode.textContent=money(displayPrice(selectedProduct,selectedVariant));return;}
    const remove=e.target.closest('[data-remove-cart]'); if(remove){removeCartItem(remove.dataset.removeCart);return;}
    if(e.target.id==='addProductBtn'&&selectedProduct){addToCart(selectedProduct,selectedVariant||selectedProduct.variants[0]);return;}
    if(e.target.id==='cartBtn'){openCart();return;} if(e.target.id==='closeCart'){closeCart();return;}
    if(e.target.id==='overlay'){closeCart();$('checkoutModal').classList.remove('open');$('overlay').classList.remove('open');return;}
    if(e.target.id==='checkoutBtn'){if(!cartItems().length){toast('Your cart is empty');return;}closeCart();$('checkoutModal').classList.add('open');$('overlay').classList.add('open');return;}
    if(e.target.id==='closeCheckout'){$('checkoutModal').classList.remove('open');if(!$('cartDrawer').classList.contains('open'))$('overlay').classList.remove('open');return;}
    if(e.target.id==='whatsappBtn' || e.target.closest('[data-whatsapp-product]')){const n=normalizeWhatsApp(settings.whatsapp_number||e.target.dataset.number||'');if(!n){toast('WhatsApp number is not configured');return;}const msg=selectedProduct?`Hello Lekhvi, I want more information about: ${selectedProduct.name}`:'Hello Lekhvi, I would like more information about your products.';window.open(`https://wa.me/${n}?text=${encodeURIComponent(msg)}`,'_blank','noopener');return;}
    if(e.target.dataset.heroIndex){showHero(Number(e.target.dataset.heroIndex));if(heroTimer)setupHeroRotator();return;}
    if(!e.target.closest('.searchWrap'))$('searchSuggest').classList.remove('open');
  });
  $('search').addEventListener('input',()=>{currentPage=1;searchResults();render();});
  $('search').addEventListener('keydown',(e)=>{const items=[...document.querySelectorAll('.searchItem')];if(e.key==='ArrowDown'&&items.length){e.preventDefault();searchIndex=Math.min(searchIndex+1,items.length-1);items.forEach((x,i)=>x.classList.toggle('active',i===searchIndex));}else if(e.key==='ArrowUp'&&items.length){e.preventDefault();searchIndex=Math.max(0,searchIndex-1);items.forEach((x,i)=>x.classList.toggle('active',i===searchIndex));}else if(e.key==='Enter'){e.preventDefault();if(searchIndex>=0&&items[searchIndex])items[searchIndex].click();else{document.querySelector('#shop').scrollIntoView({behavior:'smooth'});render();$('searchSuggest').classList.remove('open');}}else if(e.key==='Escape')$('searchSuggest').classList.remove('open');});
  $('age').addEventListener('change',()=>{currentPage=1;render();});$('lang').addEventListener('change',()=>{currentPage=1;render();});$('format').addEventListener('change',()=>{currentPage=1;render();});$('sort').addEventListener('change',()=>{currentPage=1;render();});
  $('checkoutForm').addEventListener('submit',submitOrder);
  window.addEventListener('storage', updateCartUI);
  boot();
})();
