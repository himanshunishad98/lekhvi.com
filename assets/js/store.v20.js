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
  const PLACEHOLDER = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450"><rect width="600" height="450" fill="#eef4ff"/><text x="300" y="210" text-anchor="middle" font-family="Arial" font-size="24" font-weight="700" fill="#0f172a">Lekhvi</text><text x="300" y="250" text-anchor="middle" font-family="Arial" font-size="16" fill="#16a34a">by SkillNest</text></svg>');
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
  let selectedQuantity = 1;

  const cleanText = (value) => String(value ?? '').trim();
  function dbProduct(x) {
    const format = cleanText(x.format);
    const variants = Array.isArray(x.variants) ? x.variants.filter(v => v && typeof v === 'object').map(v => ({
      ...v,
      name: cleanText(v.name),
      delivery: cleanText(v.delivery),
      price: safePrice(v.price, x.price)
    })) : [];
    return {
      id: Number(x.id), sku: cleanText(x.sku), name: cleanText(x.name), collection: cleanText(x.collection), subcategory: cleanText(x.subcategory),
      ageRange: cleanText(x.age_range), classRange: cleanText(x.class_range), language: cleanText(x.language), format,
      shortDescription: cleanText(x.short_description), description: cleanText(x.description), price: toPriceNumber(x.price), compareAt: toPriceNumber(x.compare_at),
      stock: toPriceNumber(x.stock), published: !!x.published, featured: !!x.featured, rating: Number(x.rating || 0), tags: Array.isArray(x.tags) ? x.tags.map(cleanText).filter(Boolean) : [],
      whatYouGet: Array.isArray(x.what_you_get) ? x.what_you_get.map(cleanText).filter(Boolean) : [], features: x.features && typeof x.features === 'object' ? x.features : {},
      variants: variants.length ? variants : (format ? [{ name: format, price: safePrice(x.price), delivery: 'Physical delivery' }] : []),
      images: Array.isArray(x.images) ? x.images.map(cleanText).filter(Boolean) : [], sampleCaption: cleanText(x.sample_caption), purpose: cleanText(x.purpose), updatedAt: cleanText(x.updated_at)
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
    const name = settings.store_name || 'Lekhvi';
    $('brandName').textContent = name;
    $('footerName').textContent = name;
    const configuredTagline = String(settings.store_tagline || '').trim();
    $('brandTag').textContent = (!configuredTagline || /learn\s*[·•]\s*practice\s*[·•]\s*create/i.test(configuredTagline)) ? 'A SkillNest product' : `${configuredTagline} · A SkillNest product`;
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
      <div class="heroMeta"><span>✓ <strong id="productCount">0</strong> products in catalogue</span><span>✓ Live from Supabase</span><span class="heroProductPrice" ${Number(h.product?.price)>0?'':'hidden'}>${Number(h.product?.price)>0 ? `${money(h.product.price)}${Number(h.product.compare_at)>Number(h.product.price) ? ` <del>${money(h.product.compare_at)}</del>` : ''}` : ''}</span><span>${h.badge ? '✓ ' + escapeHtml(h.badge) : '✓ Independent storefront'}</span></div>`;
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
    if (priceNode) { const hasPrice = Number(h.product?.price) > 0; priceNode.classList.toggle('hidden', !hasPrice); priceNode.innerHTML = hasPrice ? money(h.product.price) + (Number(h.product.compare_at) > Number(h.product.price) ? ` <del>${money(h.product.compare_at)}</del>` : '') : ''; }
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
    const hasImage = !!p.images?.[0];
    const productPrice = productBasePrice(p);
    const meta = [p.ageRange, p.classRange, p.language].filter(Boolean);
    const categoryBadge = p.stock > 0 && p.stock < 5 ? 'Low stock' : (p.collection || '');
    const categoryTag = p.subcategory || p.format || '';
    const badgeMarkup = categoryBadge ? (hasImage ? `<div class="badge">${escapeHtml(categoryBadge)}</div>` : `<div class="inlineBadge">${escapeHtml(categoryBadge)}</div>`) : '';
    const cardDescription = p.shortDescription || p.description || '';
    const priceMarkup = productPrice > 0
      ? `<div class="price"><strong>${money(productPrice)}</strong>${p.compareAt > productPrice ? ` <del>${money(p.compareAt)}</del>` : ''}</div>`
      : '';
    return `<article class="product">
      ${badgeMarkup}
      ${hasImage ? `<div class="pimg"><img src="${escapeHtml(p.images[0])}" alt="${escapeHtml(p.name)}" loading="lazy"></div>` : ''}
      <div class="productBody">
        ${categoryTag ? `<span class="tag">${escapeHtml(categoryTag)}</span>` : ''}
        ${meta.length ? `<small>${meta.map(escapeHtml).join(' · ')}</small>` : ''}
        <h3>${escapeHtml(p.name)}</h3>
        ${cardDescription ? `<p>${escapeHtml(cardDescription)}</p>` : ''}
        <div class="priceRow">${priceMarkup}<button class="btn btnPrimary tiny" type="button" data-view-product="${p.id}">View</button></div>
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
    selectedQuantity = 1;
    // Use the exact live products.price value from Supabase as the PDP base price.
    selectedProduct.price = productBasePrice(data);
    const firstVariant = selectedProduct.variants.find(v => v && String(v.name || '').trim());
    selectedVariant = firstVariant
      ? { ...firstVariant, price: displayPrice(selectedProduct, firstVariant) }
      : { name: selectedProduct.format, price: productBasePrice(selectedProduct), delivery: '' };
    renderPdp();
  }

  function renderPdp() {
    const p = selectedProduct; if (!p) return;
    const images = (p.images || []).filter(Boolean);
    const basePrice = productBasePrice(p);
    const variants = (p.variants || []).filter(v => v && String(v.name || '').trim());
    const showVariantSelector = variants.length > 1;
    const description = formatDescription(p.description || p.shortDescription || '');
    const chips = [p.subcategory, p.ageRange, p.classRange, p.language, p.format].filter(Boolean);
    const infoCards = [];
    if (p.whatYouGet?.length) infoCards.push(`<div class="infoCard"><b>What's included</b><ul>${p.whatYouGet.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`);
    if (p.purpose) infoCards.push(`<div class="infoCard"><b>Buying purpose</b><div>${escapeHtml(p.purpose)}</div></div>`);
    const effectivePrice = displayPrice(p, selectedVariant);
    const canPurchase = effectivePrice > 0 && Number(p.stock) > 0;
    const gallery = images.length ? `<div class="gallery"><div class="thumbs">${images.map((src,i)=>`<button type="button" data-thumb="${i}" aria-label="Show sample ${i+1}"><img src="${escapeHtml(src)}" alt="Sample ${i+1}"></button>`).join('')}</div><div class="mainpic"><img id="mainPic" src="${escapeHtml(images[0])}" alt="${escapeHtml(p.name)} sample preview"></div></div>` : '';
    const selector = showVariantSelector ? `<div class="toggle">${variants.map((v,i)=>`<button type="button" class="${v.name === selectedVariant?.name ? 'sel' : ''}" data-variant-index="${i}">${escapeHtml(v.name || p.format || 'Option')} · ${money(displayPrice(p,v))}</button>`).join('')}</div>` : '';
    const priceMarkup = effectivePrice > 0 ? `${basePrice > 0 ? `<div class="basePrice">Current product price <strong>${money(basePrice)}</strong></div>` : ''}${selector}<div class="priceBig" id="pdpPrice">${money(effectivePrice)}</div>` : '';
    const sampleMarkup = p.sampleCaption ? `<div class="sampleBox"><strong>Sample preview:</strong> ${escapeHtml(p.sampleCaption)}</div>` : '';
    const shipMarkup = canPurchase ? `<div class="ship"><div class="counttext" id="shipText">Add printed products to move toward ₹499 free shipping.</div><div class="bar"><i id="shipBar"></i></div></div>` : '';
    const quantityMax = Math.max(1, Number(p.stock) || 1);
    const quantityMarkup = canPurchase ? `<div class="pdpPurchaseControls"><label for="pdpQuantity">Quantity</label><div class="qtyControl"><button type="button" data-pdp-qty-step="-1" aria-label="Decrease quantity" ${selectedQuantity <= 1 ? 'disabled' : ''}>−</button><input id="pdpQuantity" type="number" min="1" max="${quantityMax}" value="${Math.max(1, selectedQuantity)}" inputmode="numeric" aria-label="Product quantity"><button type="button" data-pdp-qty-step="1" aria-label="Increase quantity" ${selectedQuantity >= quantityMax ? 'disabled' : ''}>+</button></div><small>${Number(p.stock)} in stock</small></div>` : '';
    const purchaseButtons = canPurchase
      ? `<button class="btn btnPrimary" type="button" id="addProductBtn">Add to cart</button><button class="btn btnSecondary" type="button" id="buyNowBtn">Buy now</button>`
      : '';
    $('pdp').classList.toggle('no-gallery', !images.length);
    $('pdp').innerHTML = `
      ${gallery}
      <div class="pdpDetails">
        ${p.collection ? `<span class="tag">${escapeHtml(p.collection.toUpperCase())}</span>` : ''}
        <h2>${escapeHtml(p.name)}</h2>
        ${Number(p.rating) > 0 ? `<div class="stars">★★★★★ <span class="ratingMeta">${escapeHtml(p.rating)}</span></div>` : ''}
        ${chips.length ? `<div class="chips">${chips.map(x=>`<span class="chip">${escapeHtml(x)}</span>`).join('')}</div>` : ''}
        ${description ? `<div class="descriptionContent">${description}</div>` : ''}
        ${priceMarkup}
        ${sampleMarkup}
        ${infoCards.length ? `<div class="infoGrid">${infoCards.join('')}</div>` : ''}
        ${shipMarkup}
        ${quantityMarkup}
        <div class="heroCtas">${purchaseButtons}<button class="btn btnSecondary" type="button" data-whatsapp-product="1">Ask on WhatsApp</button></div>
      </div>`;
    updateShippingBar();
    const priceNode = $('pdpPrice');
    if (priceNode && basePrice > 0 && toPriceNumber(priceNode.textContent) === 0) {
      priceNode.textContent = money(basePrice);
      selectedVariant = selectedVariant ? { ...selectedVariant, price: basePrice } : null;
    }
  }

  function cartItems() { try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; } }
  function saveCart(items) { localStorage.setItem(CART_KEY, JSON.stringify(items)); updateCartUI(); }
  function clampQuantity(value, max = 999) {
    const n = Math.floor(Number(value) || 1);
    return Math.max(1, Math.min(Number.isFinite(max) && max > 0 ? max : 999, n));
  }
  function syncPdpQtyButtons() {
    const input = $('pdpQuantity');
    if (!input || !selectedProduct) return;
    const max = Math.max(1, Number(selectedProduct.stock) || 1);
    const qty = clampQuantity(input.value, max);
    const minus = document.querySelector('[data-pdp-qty-step="-1"]');
    const plus = document.querySelector('[data-pdp-qty-step="1"]');
    if (minus) minus.disabled = qty <= 1;
    if (plus) plus.disabled = qty >= max;
  }
  function readPdpQuantity() {
    const input = $('pdpQuantity');
    const max = Math.max(1, Number(selectedProduct?.stock) || 1);
    selectedQuantity = clampQuantity(input?.value, max);
    if (input) input.value = selectedQuantity;
    syncPdpQtyButtons();
    return selectedQuantity;
  }
  function addToCart(p, variant, quantity = 1, options = {}) {
    const items = cartItems();
    const variantKey = variant?.name || p.format || 'default';
    const displayVariantName = variant?.name || p.format || '';
    const key = `${p.id}:${variantKey}`;
    const found = items.find(x => x.key === key);
    const price = displayPrice(p, variant);
    const qty = clampQuantity(quantity, Math.max(1, Number(p.stock) || 1));
    if (found) {
      found.quantity = clampQuantity(Number(found.quantity || 0) + qty, Math.max(1, Number(p.stock) || Number(found.stock) || 999));
      found.price = price;
      found.stock = Number(p.stock) || Number(found.stock) || 0;
      found.variantName = displayVariantName;
      found.name = p.name;
      found.image = p.images?.[0] || '';
    } else {
      items.push({ key, productId: p.id, name: p.name, variantName: displayVariantName, price, image: p.images?.[0] || '', quantity: qty, stock: Number(p.stock) || 0 });
    }
    saveCart(items);
    if (!options.silent) toast(`${qty} × ${p.name} added to cart`);
    if (options.openDrawer !== false) openCart();
  }
  function removeCartItem(key) { saveCart(cartItems().filter(x => x.key !== key)); }
  function setCartQuantity(key, nextQuantity) {
    const items = cartItems();
    const item = items.find(x => x.key === key);
    if (!item) return;
    const max = Number(item.stock) > 0 ? Number(item.stock) : 999;
    item.quantity = clampQuantity(nextQuantity, max);
    saveCart(items);
  }
  function updateCartUI() {
    const items = cartItems();
    $('cartCount').textContent = items.reduce((n,i)=>n+Number(i.quantity||0),0);
    const subtotal = items.reduce((n,i)=>n+Number(i.price||0)*Number(i.quantity||0),0);
    $('cartSubtotal').textContent = money(subtotal);
    $('cartItems').innerHTML = items.length ? items.map(i => {
      const key = escapeHtml(i.key);
      const qty = clampQuantity(i.quantity, Number(i.stock) > 0 ? Number(i.stock) : 999);
      const max = Number(i.stock) > 0 ? Number(i.stock) : 999;
      const hasImage = !!i.image && i.image !== PLACEHOLDER;
      return `<div class="item">${hasImage ? `<div class="thumb"><img src="${escapeHtml(i.image)}" alt=""></div>` : ''}<div class="itemMain"><h4>${escapeHtml(i.name)}</h4>${i.variantName ? `<small>${escapeHtml(i.variantName)}</small>` : ''}<div class="cartQtyControls"><button type="button" data-cart-step="-1" data-cart-key="${key}" aria-label="Decrease quantity" ${qty <= 1 ? 'disabled' : ''}>−</button><input type="number" min="1" max="${max}" value="${qty}" data-cart-qty="${key}" aria-label="Quantity for ${escapeHtml(i.name)}"><button type="button" data-cart-step="1" data-cart-key="${key}" aria-label="Increase quantity" ${qty >= max ? 'disabled' : ''}>+</button></div><small class="lineTotal">${money(Number(i.price || 0) * qty)}</small><button type="button" data-remove-cart="${key}">Remove</button></div></div>`;
    }).join('') : '<div class="empty">Your cart is empty.</div>';
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
    box.innerHTML='<div class="searchHead"><span>'+matches.length+' matching product'+(matches.length===1?'':'s')+'</span><span>Click to view</span></div>'+shown.map((p,i)=>{const metadata=[p.collection,p.ageRange,p.classRange,p.language,p.format].filter(Boolean).map(escapeHtml);const image=p.images?.[0]?`<img src="${escapeHtml(p.images[0])}" alt="">`:'';const price=productBasePrice(p)>0?`<div class="searchPrice">${money(p.price)}</div>`:'';return `<div class="searchItem ${image?'hasSearchImage':'noSearchImage'}" role="option" tabindex="0" data-search-product="${p.id}" data-index="${i}">${image}<div><b>${escapeHtml(p.name)}</b>${metadata.length?`<small>${metadata.join(' · ')}</small>`:''}</div>${price}</div>`;}).join('')+(matches.length>shown.length?'<div class="searchFoot"><button type="button" id="searchAllBtn">View all matching products</button></div>':'');
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
    const variant=e.target.closest('[data-variant-index]'); if(variant){const i=Number(variant.dataset.variantIndex);const variants=(selectedProduct?.variants||[]).filter(v=>v&&String(v.name||'').trim());const raw=variants[i];selectedVariant=raw?{...raw,price:displayPrice(selectedProduct,raw)}:{name:selectedProduct?.format||'Product',price:productBasePrice(selectedProduct)};document.querySelectorAll('[data-variant-index]').forEach(b=>b.classList.toggle('sel',b===variant));const priceNode=$('pdpPrice');if(priceNode)priceNode.textContent=money(displayPrice(selectedProduct,selectedVariant));return;}
    const remove=e.target.closest('[data-remove-cart]'); if(remove){removeCartItem(remove.dataset.removeCart);return;}
    const pdpQtyStep=e.target.closest('[data-pdp-qty-step]');if(pdpQtyStep&&selectedProduct){const input=$('pdpQuantity');const max=Math.max(1,Number(selectedProduct.stock)||1);selectedQuantity=clampQuantity(Number(input?.value||selectedQuantity)+Number(pdpQtyStep.dataset.pdpQtyStep),max);if(input)input.value=selectedQuantity;syncPdpQtyButtons();return;}
    const cartQtyStep=e.target.closest('[data-cart-step]');if(cartQtyStep){const item=cartItems().find(x=>x.key===cartQtyStep.dataset.cartKey);if(item)setCartQuantity(item.key,Number(item.quantity||1)+Number(cartQtyStep.dataset.cartStep));return;}
    if(e.target.id==='addProductBtn'&&selectedProduct){addToCart(selectedProduct,selectedVariant||selectedProduct.variants[0],readPdpQuantity());return;}
    if(e.target.id==='buyNowBtn'&&selectedProduct){if(!(displayPrice(selectedProduct,selectedVariant||selectedProduct.variants[0])>0)||Number(selectedProduct.stock)<1){toast('This product is not currently available to purchase.');return;}addToCart(selectedProduct,selectedVariant||selectedProduct.variants[0],readPdpQuantity(),{openDrawer:false,silent:true});$('cartDrawer').classList.remove('open');$('checkoutModal').classList.add('open');$('overlay').classList.add('open');return;}
    if(e.target.id==='cartBtn'){openCart();return;} if(e.target.id==='closeCart'){closeCart();return;}
    if(e.target.id==='overlay'){closeCart();$('checkoutModal').classList.remove('open');$('overlay').classList.remove('open');return;}
    if(e.target.id==='checkoutBtn'){if(!cartItems().length){toast('Your cart is empty');return;}closeCart();$('checkoutModal').classList.add('open');$('overlay').classList.add('open');return;}
    if(e.target.id==='closeCheckout'){$('checkoutModal').classList.remove('open');if(!$('cartDrawer').classList.contains('open'))$('overlay').classList.remove('open');return;}
    if(e.target.id==='whatsappBtn' || e.target.closest('[data-whatsapp-product]')){const n=normalizeWhatsApp(settings.whatsapp_number||e.target.dataset.number||'');if(!n){toast('WhatsApp number is not configured');return;}const msg=selectedProduct?`Hello SkillNest team, I want more information about the Lekhvi product: ${selectedProduct.name}`:'Hello SkillNest team, I would like more information about Lekhvi products.';window.open(`https://wa.me/${n}?text=${encodeURIComponent(msg)}`,'_blank','noopener');return;}
    if(e.target.dataset.heroIndex){showHero(Number(e.target.dataset.heroIndex));if(heroTimer)setupHeroRotator();return;}
    if(!e.target.closest('.searchWrap'))$('searchSuggest').classList.remove('open');
  });
  $('search').addEventListener('input',()=>{currentPage=1;searchResults();render();});
  $('search').addEventListener('keydown',(e)=>{const items=[...document.querySelectorAll('.searchItem')];if(e.key==='ArrowDown'&&items.length){e.preventDefault();searchIndex=Math.min(searchIndex+1,items.length-1);items.forEach((x,i)=>x.classList.toggle('active',i===searchIndex));}else if(e.key==='ArrowUp'&&items.length){e.preventDefault();searchIndex=Math.max(0,searchIndex-1);items.forEach((x,i)=>x.classList.toggle('active',i===searchIndex));}else if(e.key==='Enter'){e.preventDefault();if(searchIndex>=0&&items[searchIndex])items[searchIndex].click();else{document.querySelector('#shop').scrollIntoView({behavior:'smooth'});render();$('searchSuggest').classList.remove('open');}}else if(e.key==='Escape')$('searchSuggest').classList.remove('open');});
  $('age').addEventListener('change',()=>{currentPage=1;render();});$('lang').addEventListener('change',()=>{currentPage=1;render();});$('format').addEventListener('change',()=>{currentPage=1;render();});$('sort').addEventListener('change',()=>{currentPage=1;render();});
  document.addEventListener('change', (e) => {
    if (e.target.id === 'pdpQuantity' && selectedProduct) { readPdpQuantity(); return; }
    const cartQty = e.target.closest('[data-cart-qty]');
    if (cartQty) setCartQuantity(cartQty.dataset.cartQty, cartQty.value);
  });
  $('checkoutForm').addEventListener('submit',submitOrder);
  window.addEventListener('storage', updateCartUI);
  boot();
})();
