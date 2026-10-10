(function () {
  'use strict';
  const CFG = window.LEKHVI_CONFIG || {};
  const sb = window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_PUBLISHABLE_KEY
    ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } }) : null;
  const $ = (id) => document.getElementById(id);
  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const PRODUCT_BUCKET = CFG.PRODUCT_BUCKET || 'product-images';
  const SITE_BUCKET = CFG.SITE_BUCKET || 'site-assets';
  const pageTitles = { dashboard:'Dashboard', products:'Products', orders:'Orders', hero:'Hero Offers', settings:'Website Settings' };

  let collections = [];
  let settings = {};
  let products = [];
  let currentProduct = null;
  let heroes = [];
  let currentProductHero = null;
  let collectionWarningShown = false;
  const NEW_SUBCATEGORY_VALUE = '__add_new_subcategory__';
  const DEFAULT_COLLECTION_NAMES = [
    'Preschool & Early Learning',
    'School Practice & Curriculum',
    'Planners & Daily Productivity',
    'Activity, Coloring & Return Gifts',
    'Stationery, Labels & Paper Supplies'
  ];
  const PREDEFINED_SUBCATEGORIES = {
    'Preschool & Early Learning': [
      'Tracing & Handwriting', 'Worksheet Bundles', 'Cognitive & Fine Motor', 'Basic Concepts'
    ],
    'School Practice & Curriculum': [
      'Mathematics & Drills', 'Languages & Literacy', 'General Studies & Geography', 'Teacher & Exam Resources'
    ],
    'Planners & Daily Productivity': [
      'Academic & Student Planners', 'Goal & Life Trackers', 'Desk Pads & Organizers'
    ],
    'Activity, Coloring & Return Gifts': [
      'Coloring Books', 'Puzzles & Brain Games', 'Bundles & Party Packs'
    ],
    'Stationery, Labels & Paper Supplies': [
      'School Name Labels', 'Planner & Decorative Stickers', 'Specialty Paper & Boards', 'Decor & Wall Prints'
    ]
  };
  const AGE_OPTIONS = [
    { value: 'Ages 2–3', label: 'Ages 2–3 (Toddler / Nursery)' },
    { value: 'Ages 3–5', label: 'Ages 3–5 (LKG / UKG)' },
    { value: 'Ages 2–6', label: 'Ages 2–6 (Preschool & Early Learning)' },
    { value: 'Ages 6–8', label: 'Ages 6–8 (Early Primary)' },
    { value: 'Ages 9–12', label: 'Ages 9–12 (Upper Primary)' },
    { value: 'Teens & Adults', label: 'Teens & Adults (Board Exam / Life Planners)' },
    { value: 'All ages', label: 'All ages' }
  ];
  const CLASS_OPTIONS = [
    { value: 'Nursery', label: 'Nursery' },
    { value: 'LKG', label: 'LKG' },
    { value: 'UKG', label: 'UKG' },
    ...Array.from({ length: 8 }, (_, i) => ({ value: `Class ${i + 1}`, label: `Class ${i + 1}` })),
    { value: 'Classes 1–8', label: 'Classes 1–8 (all primary classes)' },
    { value: 'Board Exam', label: 'Board Exam' },
    { value: 'Teens & Adults', label: 'Teens & Adults' },
    { value: 'Not class-specific', label: 'Not class-specific' }
  ];

  async function fetchAll(table, builder) {
    const out=[]; const size=1000;
    for(let from=0;;from+=size){
      const {data,error}=await builder(sb.from(table)).range(from,from+size-1);
      if(error) throw error; out.push(...(data||[])); if(!data||data.length<size) break;
    }
    return out;
  }
  function dbProduct(x){return {id:Number(x.id),sku:x.sku||'',name:x.name||'',collection:x.collection||'',subcategory:x.subcategory||'',ageRange:x.age_range||'',classRange:x.class_range||'',language:x.language||'',format:x.format||'',shortDescription:x.short_description||'',description:x.description||'',price:Number(x.price||0),compareAt:Number(x.compare_at||0),stock:Number(x.stock??0),published:!!x.published,featured:!!x.featured,rating:Number(x.rating||0),tags:Array.isArray(x.tags)?x.tags:[],whatYouGet:Array.isArray(x.what_you_get)?x.what_you_get:[],features:x.features&&typeof x.features==='object'?x.features:{},variants:Array.isArray(x.variants)?x.variants:[],images:Array.isArray(x.images)?x.images:[],sampleCaption:x.sample_caption||'',purpose:x.purpose||'',updatedAt:x.updated_at||''};}
  function toDb(p){return {sku:p.sku||null,name:p.name,collection:p.collection,subcategory:p.subcategory||null,age_range:p.ageRange||null,class_range:p.classRange||null,language:p.language||null,format:p.format||null,short_description:p.shortDescription||null,description:p.description||null,price:Number(p.price)||0,compare_at:Number(p.compareAt)||null,stock:Number(p.stock)||0,published:!!p.published,featured:!!p.featured,rating:Number(p.rating)||0,tags:p.tags||[],what_you_get:p.whatYouGet||[],features:p.features||{},variants:p.variants||[],images:p.images||[],sample_caption:p.sampleCaption||null,purpose:p.purpose||null,updated_at:new Date().toISOString()};}
  function toast(message, error=false){const t=$('toast');t.textContent=message;t.style.background=error?'#9b2d24':'#1f2b23';t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),2800);}
  function openModal(id){$(id).classList.add('open');}
  function closeModal(id){$(id).classList.remove('open');}
  function normalizeWhatsApp(v){let d=String(v||'').replace(/\D/g,'');if(d.length===10)d='91'+d;return d;}

  async function ensureAdmin(){
    // Production rule: this page is Supabase-authenticated only.
    // There is deliberately no localStorage/browser-admin fallback.
    if(!sb){ showLogin(); showLoginMessage('Supabase is not configured. Admin access is unavailable.', true); return false; }
    showLogin();
    const {data:{session},error:sessionError}=await sb.auth.getSession();
    if(sessionError){ showLoginMessage('Unable to verify your session. Please try again.', true); return false; }
    if(!session?.user){ return false; }
    const user=session.user;
    const {data:profile,error:profileError}=await sb.from('admin_profiles').select('id,email,is_admin').eq('id',user.id).maybeSingle();
    if(profileError){
      await sb.auth.signOut();
      showLoginMessage('Admin authorization could not be verified. Check the Supabase RLS/admin profile setup.', true);
      return false;
    }
    if(profile?.is_admin !== true){
      await sb.auth.signOut();
      showLoginMessage('Access denied. This Supabase account is not an administrator.', true);
      return false;
    }
    showApp();
    return true;
  }
  function showLogin(){ $('login').classList.remove('hidden'); $('app').classList.add('hidden'); }
  function showLoginMessage(msg,error=false){const el=$('loginMessage');el.textContent=msg;el.className='notice '+(error?'error':'');el.classList.remove('hidden');}
  function showApp(){ $('login').classList.add('hidden'); $('app').classList.remove('hidden'); }

  async function loadCollections(){
    let dbRows=[];
    try {
      const {data,error}=await sb.from('collections').select('*').order('sort_order',{ascending:true}).order('id',{ascending:true});
      if(error) throw error;
      dbRows=data||[];
    } catch (error) {
      // Keep the form usable when a policy/table issue prevents loading collection rows.
      console.warn('Lekhvi collection lookup failed; using the standard collection choices.', error);
      if(!collectionWarningShown){toast('Could not load saved collection settings. Standard collection choices are available.',true);collectionWarningShown=true;}
    }
    const byName=new Map(DEFAULT_COLLECTION_NAMES.map((name,i)=>[name,{name,slug:'',sort_order:i+1,active:true}]));
    dbRows.filter(c=>c&&c.name&&c.active!==false).forEach(c=>byName.set(c.name,{...(byName.get(c.name)||{}),...c}));
    // Preserve collections already used by products, even if their collection row was removed.
    products.forEach(p=>{if(p.collection&&!byName.has(p.collection))byName.set(p.collection,{name:p.collection,sort_order:1000,active:true});});
    collections=[...byName.values()].filter(c=>c.active!==false).sort((a,b)=>(Number(a.sort_order)||999)-(Number(b.sort_order)||999)||String(a.name).localeCompare(String(b.name)));
    renderCollectionSelects();
    $('collectionOverview').innerHTML=collections.map(c=>`<span class="pill published">${esc(c.name)}</span>`).join('')||'<span class="muted">Standard collection choices are available in the product form.</span>';
  }
  function renderCollectionSelects(preferred=''){
    const form=$('fCollection'),filter=$('productCollectionFilter');
    const formValue=preferred||form?.value||currentProduct?.collection||'';
    const filterValue=filter?.value||'all';
    const rows=[...collections];
    products.forEach(p=>{if(p.collection&&!rows.some(c=>c.name===p.collection))rows.push({name:p.collection,active:true,sort_order:1000});});
    if(formValue&&!rows.some(c=>c.name===formValue))rows.push({name:formValue,active:true,sort_order:1001});
    const choices=rows.filter(c=>c.active!==false).sort((a,b)=>(Number(a.sort_order)||999)-(Number(b.sort_order)||999)||String(a.name).localeCompare(String(b.name)));
    filter.innerHTML='<option value="all">All collections</option>'+choices.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
    form.innerHTML='<option value="">Select collection</option>'+choices.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
    form.value=formValue;
    filter.value=[...filter.options].some(o=>o.value===filterValue)?filterValue:'all';
  }
  function setKnownDropdown(id, choices, selected, placeholder){
    const el=$(id), value=String(selected??'');
    const items=choices.slice();
    if(value&&!items.some(o=>o.value===value))items.push({value,label:value});
    el.innerHTML=`<option value="">${esc(placeholder)}</option>`+items.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    el.value=value;
  }
  function refreshSubcategoryOptions(selectedValue='', collectionName=$('fCollection')?.value||''){
    const el=$('fSubcategory');
    const existing=(products||[]).filter(p=>p.collection===collectionName&&p.subcategory).map(p=>String(p.subcategory).trim()).filter(Boolean);
    const names=[...(PREDEFINED_SUBCATEGORIES[collectionName]||[]),...existing];
    if(selectedValue&&selectedValue!==NEW_SUBCATEGORY_VALUE)names.push(selectedValue);
    const unique=[...new Set(names)];
    el.innerHTML='<option value="">Select subcategory (optional)</option>'+unique.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')+`<option value="${NEW_SUBCATEGORY_VALUE}">＋ Add new subcategory…</option>`;
    el.value=selectedValue&&unique.includes(selectedValue)?selectedValue:'';
    if(selectedValue&&selectedValue!==NEW_SUBCATEGORY_VALUE&&!unique.includes(selectedValue))el.value='';
    $('newSubcategoryWrap').classList.toggle('hidden',el.value!==NEW_SUBCATEGORY_VALUE);
    $('fNewSubcategory').required=el.value===NEW_SUBCATEGORY_VALUE;
    if(el.value!==NEW_SUBCATEGORY_VALUE)$('fNewSubcategory').value='';
  }
  async function loadSettings(){const {data,error}=await sb.from('site_settings').select('*').eq('id',1).maybeSingle();if(error)throw error;settings=data||{};renderSettings();applyAdminBrand();}
  function renderSettings(){
    $('storeName').value=settings.store_name||'Lekhvi.com';$('storeTagline').value=settings.store_tagline||'Learn · Practice · Create';$('whatsappNumber').value=settings.whatsapp_number||'';
    $('logoPreview').innerHTML=settings.logo_url?`<img src="${esc(settings.logo_url)}" alt="Logo">`:'<span class="muted">No logo uploaded</span>';
    $('faviconPreview').innerHTML=settings.favicon_url?`<img src="${esc(settings.favicon_url)}" alt="Favicon">`:'<span class="muted">No favicon uploaded</span>';
    const f=$('siteFavicon'); if(settings.favicon_url)f.href=settings.favicon_url;
  }
  function applyAdminBrand(){
    const name=settings.store_name||'Lekhvi.com';$('sideBrandName').textContent=name+' Admin';$('sideInitial').textContent=name.trim().charAt(0).toUpperCase()||'L';
    if(settings.logo_url){$('sideLogo').src=settings.logo_url;$('sideLogo').classList.remove('hidden');$('sideInitial').classList.add('hidden');$('loginLogo').innerHTML=`<img src="${esc(settings.logo_url)}" alt="Lekhvi logo">`;}else{$('sideLogo').classList.add('hidden');$('sideInitial').classList.remove('hidden');$('loginInitial').textContent=$('sideInitial').textContent;}
  }

  async function loadDashboardStats(){
    const [{count:all,error:aErr},{count:pub,error:pErr},{count:draft,error:dErr},{data:orders,error:oErr}]=await Promise.all([
      sb.from('products').select('id',{count:'exact',head:true}),
      sb.from('products').select('id',{count:'exact',head:true}).eq('published',true),
      sb.from('products').select('id',{count:'exact',head:true}).eq('published',false),
      sb.from('orders').select('id,total_amount')
    ]); if(aErr||pErr||dErr||oErr) throw (aErr||pErr||dErr||oErr);
    const revenue=(orders||[]).reduce((sum,o)=>sum+Number(o.total_amount||0),0);
    $('statCards').innerHTML=[['Total products',all||0],['Published',pub||0],['Draft / hidden',draft||0],['Orders / revenue',(orders||[]).length+' · '+money(revenue)]].map(([l,v])=>`<article class="stat"><small>${esc(l)}</small><strong>${esc(v)}</strong></article>`).join('');
  }

  async function loadProducts(){
    const {data,error}=await sb.from('products').select('*').order('id',{ascending:true});if(error)throw error;products=(data||[]).map(dbProduct);renderProductRows();renderCollectionSelects();}
  function renderProductRows(){
    const q=$('productSearch').value.trim().toLowerCase(),status=$('productStatus').value,col=$('productCollectionFilter').value;
    const list=products.filter(p=>(!q||[p.name,p.sku,p.collection,p.subcategory,p.ageRange,p.classRange,p.language,p.format,p.description,p.purpose,...p.tags].join(' ').toLowerCase().includes(q))&&(status==='all'||(status==='published'?p.published:!p.published))&&(col==='all'||p.collection===col));
    $('productRows').innerHTML=list.length?list.map(p=>`<tr><td><div class="tableProduct"><div class="thumb">${p.images?.[0]?`<img src="${esc(p.images[0])}" alt="">`:''}</div><div><strong>${esc(p.name)}</strong><br><span class="muted">${esc(p.sku||'')} · #${p.id}</span></div></div></td><td>${esc(p.collection||'')}<br><span class="muted">${esc(p.subcategory||'')}</span></td><td><strong>${money(p.price)}</strong></td><td>${p.stock<1?'<span class="pill out">Out</span>':p.stock<10?`<span class="pill low">${p.stock} low</span>`:p.stock}</td><td><span class="pill ${p.published?'published':'draft'}">${p.published?'Published':'Draft'}</span></td><td class="muted">${p.updatedAt?new Date(p.updatedAt).toLocaleDateString('en-IN'):'—'}</td><td><button class="btn secondary tiny" data-edit-product="${p.id}" type="button">Edit</button></td></tr>`).join(''):'<tr><td colspan="7" class="emptyTable">No products found.</td></tr>';
  }

  function blankProduct(){return {id:null,sku:'',name:'',collection:collections.find(c=>c.active!==false)?.name||'',subcategory:'',ageRange:'',classRange:'',language:'English',format:'Printed Spiral Book',shortDescription:'',description:'',price:0,compareAt:0,stock:0,published:false,featured:false,tags:[],whatYouGet:[],features:{},variants:[{name:'Printed Spiral Book',price:0,delivery:'Physical delivery'}],images:[],sampleCaption:'',purpose:''};}
  async function openProductEditor(p){currentProduct=JSON.parse(JSON.stringify(p));currentProductHero=null;$('productModalTitle').textContent=currentProduct.id?`Edit Product #${currentProduct.id}`:'Add Product';if(currentProduct.id){const {data,error}=await sb.from('hero_offers').select('*').eq('product_id',currentProduct.id).maybeSingle();if(error)throw error;currentProductHero=data||null;}fillProductForm();openModal('productModal');}
  function fillProductForm(){const p=currentProduct;$('productId').value=p.id||'';$('fName').value=p.name||'';$('fSku').value=p.sku||'';renderCollectionSelects(p.collection||'');$('fCollection').value=p.collection||'';refreshSubcategoryOptions(p.subcategory||'',p.collection||$('fCollection').value);setKnownDropdown('fAge',AGE_OPTIONS,p.ageRange||'','Select age range');setKnownDropdown('fClass',CLASS_OPTIONS,p.classRange||'','Select class (optional)');$('fLanguage').value=p.language||'';$('fFormat').value=p.format||'';$('fPrice').value=p.price||0;$('fCompare').value=p.compareAt||'';$('fStock').value=p.stock??0;$('fStatus').value=p.published?'published':'draft';$('fFeatured').value=String(!!p.featured);$('fShort').value=p.shortDescription||'';$('fDesc').value=p.description||'';$('fGet').value=(p.whatYouGet||[]).join('\n');$('fTags').value=(p.tags||[]).join(', ');$('deleteProductBtn').classList.toggle('hidden',!p.id);$('fHeroEnabled').value=String(!!currentProductHero);$('fHeroSort').value=currentProductHero?.sort_order||0;$('fHeroEyebrow').value=currentProductHero?.eyebrow||'SPECIAL OFFER';$('fHeroBadge').value=currentProductHero?.badge||'';$('fHeroTitle').value=currentProductHero?.title||p.name||'';$('fHeroDescription').value=currentProductHero?.description||p.shortDescription||'';$('fHeroImage').value='';renderHeroProductImage();renderVariants();renderImages();}
  function renderHeroProductImage(){const el=$('heroProductImagePreview'),url=currentProductHero?.image_url||'';el.innerHTML=url?`<div class="productHeroExisting"><img src="${esc(url)}" alt="Custom hero image"><button type="button" class="btn danger tiny" id="removeHeroProductImageBtn">Remove image</button></div>`:'<span class="muted">No custom hero image. Upload one above to use a product-specific hero image.</span>';}
  function gatherProduct(){const subcategory=$('fSubcategory').value===NEW_SUBCATEGORY_VALUE?$('fNewSubcategory').value.trim():$('fSubcategory').value.trim();return {...currentProduct,name:$('fName').value.trim(),sku:$('fSku').value.trim()||null,collection:$('fCollection').value,subcategory,ageRange:$('fAge').value,classRange:$('fClass').value,language:$('fLanguage').value.trim(),format:$('fFormat').value.trim(),price:Number($('fPrice').value)||0,compareAt:Number($('fCompare').value)||0,stock:Number($('fStock').value)||0,published:$('fStatus').value==='published',featured:$('fFeatured').value==='true',shortDescription:$('fShort').value.trim(),description:$('fDesc').value.trim(),whatYouGet:$('fGet').value.split('\n').map(s=>s.trim()).filter(Boolean),tags:$('fTags').value.split(',').map(s=>s.trim()).filter(Boolean),variants:currentProduct.variants||[],updatedAt:new Date().toISOString()};}
  function renderVariants(){const vs=currentProduct.variants||[];const basePrice=Number(currentProduct.price)||0;$('variants').innerHTML=vs.map((v,i)=>{const variantPrice=Number(v.price)>0?Number(v.price):basePrice;return `<div class="variant"><input placeholder="Variant name" value="${esc(v.name)}" data-v-name="${i}"><input type="number" min="0" placeholder="Price" value="${variantPrice}" data-v-price="${i}"><input placeholder="Delivery" value="${esc(v.delivery||'')}" data-v-delivery="${i}"><button class="btn danger tiny" data-remove-variant="${i}" type="button">×</button></div>`}).join('')||'<div class="muted">No variants. Add one if needed.</div>';}
  function syncVariants(){currentProduct.variants=(currentProduct.variants||[]).map((v,i)=>({name:$(`[data-v-name="${i}"]`)?.value||'',price:Number($(`[data-v-price="${i}"]`)?.value)||0,delivery:$(`[data-v-delivery="${i}"]`)?.value||''}));}
  function renderImages(){const p=currentProduct;const imgs=p.images||[];$('imageGrid').innerHTML=[0,1,2].map(i=>`<div class="imageBox">${imgs[i]?`<img src="${esc(imgs[i])}" alt="${['Cover','Inside','Detail'][i]}">`:'<div class="noImage">No image</div>'}<small>${['Cover','Inside','Detail'][i]}</small>${imgs[i]?`<div class="imageActions"><button class="btn danger tiny" type="button" data-remove-product-image="${i}">Delete image</button></div>`:''}</div>`).join('');$('uploadRow').innerHTML=[0,1,2].map(i=>`<div class="upload"><b>${['Cover','Inside','Detail'][i]}</b><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-product-image="${i}"><div class="uploadControls"><button class="btn secondary tiny" type="button" data-clear-product-image="${i}">Clear selection</button></div></div>`).join('');}
  function storagePathFromPublicUrl(url,bucket){try{const marker=`/storage/v1/object/public/${bucket}/`;const idx=String(url||'').indexOf(marker);return idx>=0?decodeURIComponent(String(url).slice(idx+marker.length)):null;}catch{return null;}}
  async function removePublicStorageUrl(url,bucket){const path=storagePathFromPublicUrl(url,bucket);if(!path)return;const {error}=await sb.storage.from(bucket).remove([path]);if(error)throw error;}
  async function removeProductImage(index){const url=currentProduct?.images?.[index];if(!url||!currentProduct?.id)return;if(!confirm(`Delete the ${['cover','inside','detail'][index]} image?`))return;try{await removePublicStorageUrl(url,PRODUCT_BUCKET);currentProduct.images[index]='';const {error}=await sb.from('products').update({images:currentProduct.images,updated_at:new Date().toISOString()}).eq('id',currentProduct.id);if(error)throw error;renderImages();toast('Product image deleted');await reloadData(['dashboard','products']);}catch(err){toast(err.message,true);}}
  async function syncProductHero(product){const enabled=$('fHeroEnabled').value==='true';if(!product?.id)return;const title=$('fHeroTitle').value.trim()||product.name;const row={product_id:product.id,eyebrow:$('fHeroEyebrow').value.trim()||'SPECIAL OFFER',title,description:$('fHeroDescription').value.trim()||product.shortDescription||'',cta_text:'View product',cta_link:`#product-${product.id}`,badge:$('fHeroBadge').value.trim(),sort_order:Number($('fHeroSort').value)||0,active:enabled && product.published,updated_at:new Date().toISOString()};const existing=currentProductHero;if(!enabled){if(existing?.image_url){try{await removePublicStorageUrl(existing.image_url,SITE_BUCKET);}catch{}}if(existing?.id){const {error}=await sb.from('hero_offers').delete().eq('id',existing.id);if(error)throw error;}currentProductHero=null;return;}let hero;const res=existing?await sb.from('hero_offers').update(row).eq('id',existing.id).select().single():await sb.from('hero_offers').insert(row).select().single();if(res.error)throw res.error;hero=res.data;const file=$('fHeroImage').files?.[0];if(file){if(file.size>8*1024*1024)throw new Error('Hero image must be 8 MB or smaller');if(existing?.image_url){try{await removePublicStorageUrl(existing.image_url,SITE_BUCKET);}catch{}}const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');const path=`hero/product-${product.id}-${Date.now()}.${ext}`;const {error:up}=await sb.storage.from(SITE_BUCKET).upload(path,file,{contentType:file.type||'image/jpeg',upsert:false,cacheControl:'31536000'});if(up)throw up;const {data:pub}=sb.storage.from(SITE_BUCKET).getPublicUrl(path);const {error:ue}=await sb.from('hero_offers').update({image_url:pub.publicUrl,updated_at:new Date().toISOString()}).eq('id',hero.id);if(ue)throw ue;hero={...hero,image_url:pub.publicUrl};}currentProductHero=hero;}
  async function saveProduct(e){e.preventDefault();syncVariants();if($('fSubcategory').value===NEW_SUBCATEGORY_VALUE&&!$('fNewSubcategory').value.trim()){toast('Enter a name for the new subcategory',true);$('fNewSubcategory').focus();return;}const p=gatherProduct();if(!p.collection){toast('Please select a collection',true);return;}if(!p.name){toast('Product name is required',true);return;}if(!p.subcategory&&$('fSubcategory').value===NEW_SUBCATEGORY_VALUE){toast('Enter a name for the new subcategory',true);return;}const basePrice=Number(p.price)||0;p.variants=(p.variants||[]).map(v=>({...v,price:Number(v.price)>0?Number(v.price):basePrice}));const saveBtn=e.submitter;saveBtn.disabled=true;try{const row=toDb(p);let res;if(p.id){res=await sb.from('products').update(row).eq('id',p.id).select().single();}else{delete row.id;row.sku=row.sku||`LEK-${Date.now()}`;res=await sb.from('products').insert(row).select().single();}if(res.error)throw res.error;currentProduct=dbProduct(res.data);await uploadSelectedProductImages();await syncProductHero(currentProduct);await loadHeroes();closeModal('productModal');toast('Product saved and catalogue reloaded');await reloadData(['dashboard','products']);}catch(err){toast(err.message,true);}finally{saveBtn.disabled=false;}}
  async function uploadSelectedProductImages(){if(!currentProduct?.id)return;const files=[...document.querySelectorAll('[data-product-image]')];for(const input of files){const file=input.files?.[0];const index=Number(input.dataset.productImage);if(!file)continue;if(file.size>6*1024*1024)throw new Error('Each product image must be 6 MB or smaller');const oldUrl=currentProduct.images?.[index]||'';if(oldUrl){try{await removePublicStorageUrl(oldUrl,PRODUCT_BUCKET);}catch{}}const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');const kind=['cover','inside','detail'][index];const path=`products/${currentProduct.id}/${kind}-${Date.now()}.${ext}`;const {error}=await sb.storage.from(PRODUCT_BUCKET).upload(path,file,{contentType:file.type||'image/jpeg',upsert:false,cacheControl:'31536000'});if(error)throw error;const {data}=sb.storage.from(PRODUCT_BUCKET).getPublicUrl(path);currentProduct.images[index]=data.publicUrl;const {error:updateErr}=await sb.from('products').update({images:currentProduct.images,updated_at:new Date().toISOString()}).eq('id',currentProduct.id);if(updateErr)throw updateErr;}}
  async function deleteProduct(){if(!currentProduct?.id||!confirm('Delete this product permanently?'))return;try{for(const url of (currentProduct.images||[]).filter(Boolean)){try{await removePublicStorageUrl(url,PRODUCT_BUCKET);}catch{}}if(currentProductHero?.image_url){try{await removePublicStorageUrl(currentProductHero.image_url,SITE_BUCKET);}catch{}}const {error}=await sb.from('products').delete().eq('id',currentProduct.id);if(error)throw error;closeModal('productModal');toast('Product deleted and catalogue reloaded');await reloadData(['dashboard','products','hero']);}catch(err){toast(err.message,true);}}

  async function loadOrders(){const orders=await fetchAll('orders',q=>q.select('*').order('created_at',{ascending:false}));if(!orders.length){$('ordersList').innerHTML='<div class="card muted">No orders available.</div>';return;}const cids=[...new Set(orders.map(o=>o.customer_id).filter(Boolean))],ids=orders.map(o=>o.id);const [{data:customers,error:ce},{data:items,error:ie}]=await Promise.all([cids.length?sb.from('customers').select('*').in('id',cids):Promise.resolve({data:[],error:null}),sb.from('order_items').select('*').in('order_id',ids)]);if(ce||ie)throw(ce||ie);const cmap=new Map((customers||[]).map(x=>[x.id,x]));const imap=new Map();(items||[]).forEach(i=>{if(!imap.has(i.order_id))imap.set(i.order_id,[]);imap.get(i.order_id).push(i)});$('ordersList').innerHTML=orders.map(o=>{const customer=cmap.get(o.customer_id)||o.customer_snapshot||{}, list=imap.get(o.id)||[];return `<article class="card orderCard"><div class="sectionHead"><div><h2>${esc(o.order_number||'Order')}</h2><p>${esc(customer.name||'Customer')} · ${esc(customer.mobile||'')} · ${o.created_at?new Date(o.created_at).toLocaleString('en-IN'):''}</p></div><strong>${money(o.total_amount)}</strong></div><p class="muted">${esc(customer.address||'')}</p><ul>${list.map(i=>`<li>${esc(i.product_name)} · ${esc(i.variant_name||'')} × ${i.quantity} = ${money(Number(i.unit_price||0)*Number(i.quantity||0))}</li>`).join('')}</ul><div class="orderTools"><select data-order-status="${o.id}">${['PENDING_PAYMENT','PAID','PROCESSING','SHIPPED','DELIVERED','CANCELLED','REFUNDED'].map(s=>`<option ${o.order_status===s?'selected':''}>${s}</option>`).join('')}</select><input placeholder="Admin note" value="${esc(o.notes||'')}" data-order-note="${o.id}"><button class="btn secondary" data-save-order="${o.id}" type="button">Save order</button></div></article>`;}).join('');}
  async function updateOrder(id){const status=document.querySelector(`[data-order-status="${id}"]`).value,note=document.querySelector(`[data-order-note="${id}"]`).value;const {error}=await sb.from('orders').update({order_status:status,notes:note,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw error;toast('Order updated');await loadOrders();await loadDashboardStats();}

  async function loadHeroes(){const {data,error}=await sb.from('hero_offers').select('*').order('sort_order',{ascending:true}).order('id',{ascending:true});if(error)throw error;heroes=data||[];renderHeroes();}
  function renderHeroes(){$('heroList').innerHTML=heroes.length?heroes.map(h=>`<article class="offerCard"><div class="offerMeta"><span class="pill ${h.active?'published':'draft'}">${h.active?'Active':'Hidden'}</span><span class="pill">Order ${h.sort_order||0}</span></div><h3>${esc(h.title)}</h3><p>${esc(h.description||'')}</p>${h.product_id?`<div class="offerMeta"><span class="pill">Linked product #${Number(h.product_id)}</span></div>`:''}${h.image_url?`<img src="${esc(h.image_url)}" alt="" class="heroImage">`:''}<div class="tools offerActions"><button class="btn secondary tiny" data-edit-hero="${h.id}" type="button">Edit</button><button class="btn danger tiny" data-delete-hero="${h.id}" type="button">Delete</button></div></article>`).join(''):'<div class="card muted">No hero offers yet. Create one to show promotions on the storefront.</div>';}
  function openHeroEditor(h=null){const x=h||{id:null,eyebrow:'OFFER',title:'',description:'',cta_text:'Shop now',cta_link:'#shop',badge:'',sort_order:heroes.length,active:true,image_url:''};$('heroModalTitle').textContent=x.id?`Edit Hero Offer #${x.id}`:'Add Hero Offer';$('heroId').value=x.id||'';$('hEyebrow').value=x.eyebrow||'';$('hTitle').value=x.title||'';$('hDescription').value=x.description||'';$('hCtaText').value=x.cta_text||'Shop now';$('hCtaLink').value=x.cta_link||'#shop';$('hBadge').value=x.badge||'';$('hSort').value=x.sort_order||0;$('hActive').value=String(x.active!==false);$('hImage').value='';$('heroImagePreview').innerHTML=x.image_url?`<img src="${esc(x.image_url)}" alt="">`:'<span class="muted">No image selected</span>';openModal('heroModal');}
  async function saveHero(e){e.preventDefault();const id=$('heroId').value;const row={eyebrow:$('hEyebrow').value.trim(),title:$('hTitle').value.trim(),description:$('hDescription').value.trim(),cta_text:$('hCtaText').value.trim(),cta_link:$('hCtaLink').value.trim()||'#shop',badge:$('hBadge').value.trim(),sort_order:Number($('hSort').value)||0,active:$('hActive').value==='true',updated_at:new Date().toISOString()};if(!row.title){toast('Hero title is required',true);return;}try{let res=id?await sb.from('hero_offers').update(row).eq('id',id).select().single():await sb.from('hero_offers').insert(row).select().single();if(res.error)throw res.error;let hero=res.data;const file=$('hImage').files?.[0];if(file){if(file.size>8*1024*1024)throw new Error('Hero image must be 8 MB or smaller');const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');const path=`hero/${hero.id}-${Date.now()}.${ext}`;const {error:up}=await sb.storage.from(SITE_BUCKET).upload(path,file,{contentType:file.type||'image/jpeg',upsert:false,cacheControl:'31536000'});if(up)throw up;const {data:pub}=sb.storage.from(SITE_BUCKET).getPublicUrl(path);const {error:ue}=await sb.from('hero_offers').update({image_url:pub.publicUrl,updated_at:new Date().toISOString()}).eq('id',hero.id);if(ue)throw ue;}closeModal('heroModal');toast('Hero offer saved');await loadHeroes();}catch(err){toast(err.message,true);}}
  async function deleteHero(id){if(!confirm('Delete this hero offer?'))return;const {error}=await sb.from('hero_offers').delete().eq('id',id);if(error){toast(error.message,true);return;}toast('Hero offer deleted');await loadHeroes();}

  async function saveSettings(){const raw=$('whatsappNumber').value.trim(),wa=normalizeWhatsApp(raw);if(wa.length<12){toast('Enter a valid WhatsApp number',true);return;}const row={id:1,store_name:$('storeName').value.trim()||'Lekhvi.com',store_tagline:$('storeTagline').value.trim()||'Learn · Practice · Create',whatsapp_number:wa,logo_url:settings.logo_url||null,favicon_url:settings.favicon_url||null,updated_at:new Date().toISOString()};const {error}=await sb.from('site_settings').upsert(row,{onConflict:'id'});if(error){toast(error.message,true);return;}settings={...settings,...row};applyAdminBrand();renderSettings();toast('Website settings saved');}
  async function uploadSiteAsset(kind){const input=kind==='logo'?$('logoFile'):$('faviconFile'),file=input.files?.[0];if(!file){toast(`Choose a ${kind} file first`,true);return;}if(file.size>5*1024*1024){toast('Please use a file smaller than 5 MB',true);return;}const ext=(file.name.split('.').pop()||'png').toLowerCase().replace(/[^a-z0-9]/g,'');const path=`site/${kind}-${Date.now()}.${ext}`;try{const {error}=await sb.storage.from(SITE_BUCKET).upload(path,file,{contentType:file.type||'image/png',upsert:false,cacheControl:'31536000'});if(error)throw error;const {data}=sb.storage.from(SITE_BUCKET).getPublicUrl(path);settings[`${kind}_url`]=data.publicUrl;const {error:ue}=await sb.from('site_settings').upsert({id:1,store_name:settings.store_name||'Lekhvi.com',store_tagline:settings.store_tagline||'',whatsapp_number:settings.whatsapp_number||'917470554811',logo_url:settings.logo_url||null,favicon_url:settings.favicon_url||null,updated_at:new Date().toISOString()},{onConflict:'id'});if(ue)throw ue;renderSettings();applyAdminBrand();input.value='';toast(`${kind[0].toUpperCase()+kind.slice(1)} uploaded to Supabase`);}catch(err){toast(err.message,true);}}

  async function reloadData(parts){const p=parts||['dashboard','products','orders','hero','settings'];try{if(p.includes('dashboard'))await loadDashboardStats();if(p.includes('products'))await loadProducts();if(p.includes('orders'))await loadOrders();if(p.includes('hero'))await loadHeroes();if(p.includes('settings'))await loadSettings();await loadCollections();}catch(err){toast(err.message,true);}}
  function goPage(page){document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));$(page+'Page').classList.add('active');document.querySelectorAll('[data-page-link]').forEach(x=>x.classList.toggle('active',x.dataset.pageLink===page));$('pageTitle').textContent=pageTitles[page]||page;location.hash=page;if(page==='dashboard')loadDashboardStats().catch(e=>toast(e.message,true));if(page==='products')loadProducts().catch(e=>toast(e.message,true));if(page==='orders')loadOrders().catch(e=>toast(e.message,true));if(page==='hero')loadHeroes().catch(e=>toast(e.message,true));if(page==='settings')loadSettings().catch(e=>toast(e.message,true));}

  $('loginForm').addEventListener('submit',async(e)=>{e.preventDefault();if(!sb){showLoginMessage('Supabase client is unavailable.',true);return;}const btn=e.submitter;btn.disabled=true;try{const {error}=await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;if(await ensureAdmin()){const hash=location.hash.replace('#','');goPage(pageTitles[hash]?hash:'dashboard');}}catch(err){showLoginMessage(err.message,true);}finally{btn.disabled=false;}});
  $('logoutBtn').addEventListener('click',async()=>{await sb.auth.signOut();showLogin();});
  $('reloadBtn').addEventListener('click',()=>reloadData());$('reloadProductsBtn').addEventListener('click',()=>reloadData(['dashboard','products']));$('reloadOrdersBtn').addEventListener('click',()=>reloadData(['dashboard','orders']));
  document.addEventListener('click',(e)=>{
    const nav=e.target.closest('[data-page-link]');if(nav){e.preventDefault();goPage(nav.dataset.pageLink);return;}
    const edit=e.target.closest('[data-edit-product]');if(edit){const p=products.find(x=>x.id===Number(edit.dataset.editProduct));if(p)openProductEditor(p).catch(err=>toast(err.message,true));return;}
    if(e.target.id==='newProductBtn'){openProductEditor(blankProduct()).catch(err=>toast(err.message,true));return;}
    const close=e.target.closest('[data-close-modal]');if(close){closeModal(close.dataset.closeModal);return;}
    const rv=e.target.closest('[data-remove-variant]');if(rv){syncVariants();currentProduct.variants.splice(Number(rv.dataset.removeVariant),1);renderVariants();return;}
    if(e.target.id==='addVariantBtn'){syncVariants();currentProduct.variants.push({name:'New variant',price:Number($('fPrice').value)||0,delivery:'Physical delivery'});renderVariants();return;}
    if(e.target.id==='deleteProductBtn'){deleteProduct();return;}
    const rim=e.target.closest('[data-remove-product-image]');if(rim){removeProductImage(Number(rim.dataset.removeProductImage));return;}
    const clearImg=e.target.closest('[data-clear-product-image]');if(clearImg){const input=document.querySelector(`[data-product-image="${clearImg.dataset.clearProductImage}"]`);if(input)input.value='';return;}
    if(e.target.id==='removeHeroProductImageBtn'){(async()=>{if(currentProductHero?.image_url){try{await removePublicStorageUrl(currentProductHero.image_url,SITE_BUCKET);}catch(err){toast(err.message,true);return;}}if(currentProductHero?.id){const {error}=await sb.from('hero_offers').update({image_url:null,updated_at:new Date().toISOString()}).eq('id',currentProductHero.id);if(error){toast(error.message,true);return;}}currentProductHero=currentProductHero?{...currentProductHero,image_url:null}:null;renderHeroProductImage();toast('Hero image removed');})().catch(err=>toast(err.message,true));return;}
    const saveOrder=e.target.closest('[data-save-order]');if(saveOrder){updateOrder(Number(saveOrder.dataset.saveOrder)).catch(err=>toast(err.message,true));return;}
    if(e.target.id==='newHeroBtn'){openHeroEditor();return;}
    const eh=e.target.closest('[data-edit-hero]');if(eh){openHeroEditor(heroes.find(h=>Number(h.id)===Number(eh.dataset.editHero)));return;}
    const dh=e.target.closest('[data-delete-hero]');if(dh){deleteHero(Number(dh.dataset.deleteHero));return;}
  });
  $('productSearch').addEventListener('input',renderProductRows);$('productStatus').addEventListener('change',renderProductRows);$('productCollectionFilter').addEventListener('change',renderProductRows);
  $('productForm').addEventListener('submit',saveProduct);$('heroForm').addEventListener('submit',saveHero);$('saveSettingsBtn').addEventListener('click',()=>saveSettings().catch(err=>toast(err.message,true)));$('uploadLogoBtn').addEventListener('click',()=>uploadSiteAsset('logo'));$('uploadFaviconBtn').addEventListener('click',()=>uploadSiteAsset('favicon'));
  $('fCollection').addEventListener('change',()=>{if(currentProduct)currentProduct.subcategory='';refreshSubcategoryOptions('',$('fCollection').value);});
  $('fSubcategory').addEventListener('change',()=>{const adding=$('fSubcategory').value===NEW_SUBCATEGORY_VALUE;$('newSubcategoryWrap').classList.toggle('hidden',!adding);$('fNewSubcategory').required=adding;if(adding){$('fNewSubcategory').value='';$('fNewSubcategory').focus();}});
  $('heroImagePreview').addEventListener('click',()=>{});$('hImage').addEventListener('change',()=>{const f=$('hImage').files?.[0];if(f){const r=new FileReader();r.onload=()=>{$('heroImagePreview').innerHTML=`<img src="${esc(r.result)}" alt="Preview">`};r.readAsDataURL(f);}});
  $('fHeroImage').addEventListener('change',()=>{const f=$('fHeroImage').files?.[0];if(f){const r=new FileReader();r.onload=()=>{$('heroProductImagePreview').innerHTML=`<img src="${esc(r.result)}" alt="Custom hero preview">`};r.readAsDataURL(f);}});
  ['logoFile','faviconFile'].forEach(id=>$(id).addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;const id=e.target.id;const target=id==='logoFile'?'logoPreview':'faviconPreview';const r=new FileReader();r.onload=()=>$(target).innerHTML=`<img src="${esc(r.result)}" alt="Preview">`;r.readAsDataURL(file);}));
  sb?.auth.onAuthStateChange((event, session)=>{
    if(event === 'SIGNED_OUT' || !session){ showLogin(); return; }
    if(event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED'){ ensureAdmin().catch(()=>showLogin()); }
  });

  async function boot(){
    if(!sb){ showLogin(); showLoginMessage('Supabase is not configured. Admin access is unavailable.', true); return; }
    if(!(await ensureAdmin())) return;
    try{
      await Promise.all([loadSettings(),loadCollections(),loadProducts(),loadHeroes(),loadDashboardStats()]);
      const hash=location.hash.replace('#','');
      goPage(pageTitles[hash]?hash:'dashboard');
    }catch(err){
      showApp();
      toast(err.message,true);
    }
  }
  boot();
})();
