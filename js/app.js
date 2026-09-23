const $ = id => document.getElementById(id);
const money = n => '$ ' + Number(n || 0).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const rootPrefix = () => (location.pathname.includes('/cliente/') || location.pathname.includes('/admin/')) ? '../' : '';
const cartKey = 'ndb_cart';
const NDB_BRANDS = ['Duke','Egoplast','Bonomini','Dealer','TF3','Faplas','Fusiogas','Medio Giro','Otros'];
const NDB_TYPES = ['Calefones','Termofusión y caños','Herramientas','Polipropileno','Polietileno','Flexibles','Accesorios PVC','Accesorios PVC 3,2','Caños PVC','Grifería, canillas y llaves','Fusión','Epoxi','Accesorios de bronce','Depósitos y mochilas','Botones y repuestos','Válvulas de descarga de agua','Brazos','Boyas','Manijas y palancas','Codos para depósitos','Conexiones para inodoro','Tapas y sobretapas','Asientos','Tornillos','Aros para inodoro','Mangueras','Diafragmas y válvulas','Sopapas y conexiones corrugadas','Sifones para pileta','Varios','Válvulas','Acoples','Química','Grasas','Cintas'];
const localCart = () => JSON.parse(localStorage.getItem(cartKey) || '[]');
const saveLocalCart = c => { localStorage.setItem(cartKey, JSON.stringify(c)); updateCartCount(); };
let PRODUCTS = [], PROFILE = null, CURRENT_USER = null, CURRENT_ROLE = null;

function configWarning(){
  if(window.ndbConfigured) return;
  const box=document.createElement('div'); box.className='config-warning';
  box.innerHTML='<b>Firebase todavía no está configurado.</b> Revisá <code>js/config.js</code>.'; document.body.prepend(box);
}

function waitForAuth(){
  return new Promise(resolve => {
    if(!window.auth) return resolve(null);
    const off=auth.onAuthStateChanged(user=>{off(); resolve(user || null);});
  });
}

async function session(){
  if(!window.auth || !window.db) return null;
  const user = auth.currentUser || await waitForAuth();
  if(!user) { CURRENT_USER=null; CURRENT_ROLE=null; return null; }
  CURRENT_USER=user;
  try {
    const snap=await db.collection('usuarios').doc(user.uid).get();
    CURRENT_ROLE=snap.exists ? (snap.data().rol || null) : null;
  } catch(e){
    console.error('No se pudo leer el perfil de Firestore:', e);
    CURRENT_ROLE=null;
  }
  return {user,role:CURRENT_ROLE};
}

async function requireUser(role){
  const s=await session();
  if(!s || (role && s.role!==role)){
    alert('Tenés que iniciar sesión con una cuenta autorizada.');
    location.href=rootPrefix()+'login.html'; return false;
  }
  return true;
}

async function logout(){
  const destino=rootPrefix()+'login.html?sesion=cerrada';
  try{
    if(window.auth) await auth.signOut();
  }catch(e){
    console.error('Error al cerrar sesión:',e);
  }finally{
    sessionStorage.setItem('ndb_logout_ok','1');
    location.href=destino;
  }
}

function showLogoutConfirmation(){
  const params=new URLSearchParams(location.search);
  const cerrada=params.get('sesion')==='cerrada' || sessionStorage.getItem('ndb_logout_ok')==='1';
  if(!cerrada) return;
  sessionStorage.removeItem('ndb_logout_ok');
  const login=$('loginPage');
  if(!login) return;
  const notice=document.createElement('div');
  notice.className='logout-success';
  notice.setAttribute('role','status');
  notice.innerHTML='<span class="logout-check">✓</span><div><b>Sesión cerrada correctamente</b><small>Ya saliste de tu cuenta de NDB.</small></div>';
  document.body.prepend(notice);
  setTimeout(()=>notice.classList.add('show'),30);
  setTimeout(()=>notice.classList.remove('show'),4200);
  if(params.has('sesion')){
    params.delete('sesion');
    const clean=location.pathname+(params.toString()?'?'+params.toString():'')+location.hash;
    history.replaceState({},'',clean);
  }
}

async function doLogin(){
  if(!window.auth) return alert('Firebase no está disponible.');
  const email=$('email').value.trim(), password=$('pass').value, btn=$('loginBtn');
  if(!email || !password) return alert('Ingresá email y contraseña.');
  btn.disabled=true; btn.textContent='Ingresando...';
  try{
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    await auth.signInWithEmailAndPassword(email,password);
    const s=await session();
    if(!s?.role){ await auth.signOut(); throw new Error('La cuenta existe, pero no tiene un rol habilitado en Firestore.'); }
    const continuar=new URLSearchParams(location.search).get('continuar');
    location.href=s.role==='admin'?'admin/presupuestos.html':(continuar||'cliente/inicio.html');
  }catch(e){
    console.error('Error de ingreso:',e);
    btn.disabled=false; btn.textContent='Ingresar';
    const msg='No se pudo ingresar: '+friendlyAuthError(e);
    const box=$('loginError'); if(box){box.textContent=msg;box.hidden=false;} else alert(msg);
  }
}
function friendlyAuthError(e){
  const c=e?.code||'';
  if(c.includes('invalid-credential')||c.includes('wrong-password')||c.includes('user-not-found')) return 'email o contraseña incorrectos.';
  if(c.includes('too-many-requests')) return 'demasiados intentos. Probá más tarde.';
  if(c.includes('unauthorized-domain')) return 'este dominio de GitHub Pages no está autorizado en Firebase Authentication.';
  if(c.includes('network-request-failed')) return 'problema de conexión con Firebase. Revisá Internet y volvé a intentar.';
  return e?.message||'Error desconocido.';
}
async function redirectIfLogged(){ const s=await session(); if(s?.role) location.href=s.role==='admin'?'admin/presupuestos.html':'cliente/inicio.html'; }
function toggleMobile(){ const m=$('mobileMenu'); if(m) m.style.display=m.style.display==='block'?'none':'block'; }
function updateCartCount(){ const c=localCart().reduce((a,i)=>a+Number(i.cantidad||0),0); document.querySelectorAll('.cart-count').forEach(e=>e.textContent=c); }

function normalizeProduct(doc){ const p=doc.data(); return {id:doc.id,...p}; }
async function loadProducts(){
  if(!window.db){
    PRODUCTS=[];
    renderCats(); renderProducts(); renderOffers(); renderFeatured();
    return;
  }

  // IMPORTANTE: el catálogo se carga sin depender de Authentication.
  // Así los visitantes pueden ver productos, precios y stock aun sin iniciar sesión.
  try{
    const snap=await db.collection('productos').get();
    PRODUCTS=snap.docs.map(normalizeProduct)
      .filter(p=>p.active!==false)
      .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'es'));
  }catch(e){
    console.error('No se pudo cargar el catálogo público:',e);
    PRODUCTS=[];
    const cont=$('products');
    if(cont) cont.innerHTML='<div class="empty catalog-error"><b>No se pudo cargar el catálogo.</b><br><span>Revisá que las reglas publicadas de Firestore permitan leer <code>productos</code> sin iniciar sesión.</span></div>';
    return;
  }

  renderCats(); renderProducts(); renderOffers(); renderFeatured();

  // Authentication solo cambia los controles de compra; nunca la visibilidad del catálogo.
  session().then(()=>{
    renderProducts(); renderOffers(); renderFeatured();
    updateCatalogSessionUI();
  }).catch(()=>{});
}
function updateCatalogSessionUI(){
  const isClient=CURRENT_ROLE==='cliente';
  document.querySelectorAll('[data-client-only]').forEach(el=>el.classList.toggle('hidden',!isClient));
}
function productCard(p){
  const sinStock=Number(p.stock)<=0, img=p.image_url||rootPrefix()+'img/producto.jpg';
  const puedeComprar=CURRENT_ROLE==='cliente';
  const accion=puedeComprar
    ? `<div class="qty"><input id="qty-${p.id}" type="number" min="1" value="1"><button class="btn btn-red btn-buy" onclick="addCart('${p.id}')">Agregar</button></div>`
    : `<div class="catalog-view-only"><span>Vista de catálogo</span><a href="${rootPrefix()}login.html?continuar=productos.html">Ingresar para comprar</a></div>`;
  return `<article class="product">${p.on_sale?'<span class="badge">OFERTA</span>':''}${p.on_sale&&p.discount_percent?`<span class="discount">-${Number(p.discount_percent)}%</span>`:''}<img src="${esc(img)}" alt="${esc(p.name)}" onerror="this.src='${rootPrefix()}img/producto.jpg'"><div class="product-body"><div class="code">${esc(p.code||'')}${p.brand?' · '+esc(p.brand):''}</div><h3>${esc(p.name)}</h3><p class="muted">${esc(p.category||'Sin categoría')}</p><span class="stock ${sinStock?'agotado':''}">${sinStock?'Consultar disponibilidad':'Stock informado: '+p.stock}</span><div class="price">${p.previous_price?`<span class="old-price">${money(p.previous_price)}</span>`:''}${money(p.price)}</div>${accion}</div></article>`;
}
function filteredProducts(){ const q=($('search')?.value||'').trim().toLowerCase(),cat=$('categoryFilter')?.value||'Todos',brand=$('brandFilter')?.value||'Todas',stockOnly=$('stockFilter')?.checked||false; return PRODUCTS.filter(p=>{const h=`${p.name||''} ${p.code||''} ${p.brand||''} ${p.category||''}`.toLowerCase();return(!q||h.includes(q))&&(cat==='Todos'||p.category===cat)&&(brand==='Todas'||p.brand===brand)&&(!stockOnly||Number(p.stock)>0);}); }
function renderProducts(){ const cont=$('products'); if(!cont)return; cont.innerHTML=filteredProducts().map(productCard).join('')||'<div class="empty">No se encontraron productos.</div>'; }
function renderOffers(){ const cont=$('offers'); if(!cont)return; cont.innerHTML=PRODUCTS.filter(p=>p.on_sale).slice(0,4).map(productCard).join('')||'<div class="empty">No hay ofertas activas.</div>'; }
function renderFeatured(){ const cont=$('featured'); if(!cont)return; cont.innerHTML=(PRODUCTS.filter(p=>p.featured).slice(0,4).length?PRODUCTS.filter(p=>p.featured).slice(0,4):PRODUCTS.slice(0,4)).map(productCard).join(''); }
function renderCats(){
  const brands=[...new Set([...NDB_BRANDS,...PRODUCTS.map(p=>p.brand).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'es'));
  const cats=[...new Set([...NDB_TYPES,...PRODUCTS.map(p=>p.category).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'es'));
  const b=$('brandFilter'),c=$('categoryFilter');
  if(b){const current=b.value||'Todas';b.innerHTML='<option value="Todas">Todas las marcas</option>'+brands.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if([...b.options].some(o=>o.value===current))b.value=current;}
  if(c){const current=c.value||'Todos';c.innerHTML='<option value="Todos">Todas las categorías</option>'+cats.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if([...c.options].some(o=>o.value===current))c.value=current;}
  const bc=$('brandChips'); if(bc) bc.innerHTML=['Todas',...brands].map(v=>`<button type="button" class="filter-chip ${((b?.value||'Todas')===v)?'active':''}" onclick="setBrandFilter('${v.replace("'","\\'")}')">${v==='Todas'?'Todas':esc(v)}</button>`).join('');
  const cc=$('categoryChips'); if(cc) cc.innerHTML=['Todos',...cats].map(v=>`<button type="button" class="filter-chip ${((c?.value||'Todos')===v)?'active':''}" onclick="setCategoryFilter('${v.replace("'","\\'")}')">${v==='Todos'?'Todas':esc(v)}</button>`).join('');
}
function setBrandFilter(v){if($('brandFilter'))$('brandFilter').value=v;renderCats();renderProducts();}
function setCategoryFilter(v){if($('categoryFilter'))$('categoryFilter').value=v;renderCats();renderProducts();}
function addCart(id){ if(!CURRENT_USER)return alert('Iniciá sesión para agregar productos.'); const p=PRODUCTS.find(x=>String(x.id)===String(id));if(!p)return;const q=Math.max(1,parseInt($('qty-'+id)?.value||1));let c=localCart(),it=c.find(x=>String(x.id)===String(id)),current=it?Number(it.cantidad):0;if(current+q>Number(p.stock))return alert('No hay suficiente stock disponible.');if(it)it.cantidad+=q;else c.push({id:p.id,code:p.code,name:p.name,price:Number(p.price),cantidad:q});saveLocalCart(c);alert('Producto agregado al carrito.'); }
function removeCart(i){let c=localCart();c.splice(i,1);saveLocalCart(c);renderCart();}
function changeQty(i,q){let c=localCart();let n=Math.max(1,parseInt(q)||1);c[i].cantidad=n;saveLocalCart(c);renderCart();}
function clearCart(){saveLocalCart([]);renderCart();}
function renderCart(){const cont=$('cartItems');if(!cont)return;const c=localCart();let total=0;if(!c.length){cont.innerHTML='<div class="empty">El carrito está vacío.</div>';if($('cartTotal'))$('cartTotal').textContent=money(0);return;}cont.innerHTML=c.map((i,idx)=>{const sub=Number(i.price)*Number(i.cantidad);total+=sub;return `<div class="cart-item"><div class="row"><div><b>${esc(i.name)}</b><div class="code">${esc(i.code||'')}</div></div><b>${money(sub)}</b></div><p class="muted">Unitario ${money(i.price)}</p><div class="row"><label>Cantidad <input class="field qty-small" type="number" min="1" value="${i.cantidad}" onchange="changeQty(${idx},this.value)"></label><button class="btn btn-light" onclick="removeCart(${idx})">Quitar</button></div></div>`}).join('');$('cartTotal').textContent=money(total);}

async function loadProfile(){
  if(!$('razon')&&!$('clientName'))return;if(!(await requireUser('cliente')))return;
  try{const snap=await db.collection('usuarios').doc(CURRENT_USER.uid).get();if(!snap.exists)return;const data=snap.data();PROFILE=data;const map={razon:'business_name',tel:'phone',calle:'address',barrio:'neighborhood',localidad:'city',mail:'email'};for(const [id,key] of Object.entries(map))if($(id))$(id).value=data[key]||'';if($('clientName'))$('clientName').textContent=data.business_name||data.nombre||CURRENT_USER.email;}catch(e){console.error(e);}
}
async function saveProfile(){if(!(await requireUser('cliente')))return;const payload={business_name:$('razon').value.trim(),phone:$('tel').value.trim(),address:$('calle').value.trim(),neighborhood:$('barrio').value.trim(),city:$('localidad').value.trim(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()};try{await db.collection('usuarios').doc(CURRENT_USER.uid).update(payload);alert('Perfil guardado.');}catch(e){alert('No se pudo guardar: '+e.message);}}

function orderNumber(order){return order.numero||`NDB-${String(order.id).slice(0,8).toUpperCase()}`;}
function dateText(v){if(!v)return '';const d=v.toDate?v.toDate():new Date(v);return d.toLocaleString('es-AR');}
async function makeOrder(){
  if(!(await requireUser('cliente')))return;
  const c=localCart(); if(!c.length)return alert('El carrito está vacío.');
  const btn=$('confirmOrderBtn'); if(btn){btn.disabled=true;btn.textContent='Confirmando...';}
  try{
    // Relee cada producto desde Firestore para no confiar en precios guardados en el navegador.
    const fresh=[];
    for(const line of c){
      const snap=await db.collection('productos').doc(String(line.id)).get();
      if(!snap.exists) throw new Error('Uno de los productos ya no está disponible.');
      const p={id:snap.id,...snap.data()};
      const cantidad=Math.max(1,Math.min(999,parseInt(line.cantidad)||1));
      fresh.push({product_id:p.id,code:String(p.code||''),name:String(p.name||''),price:Number(p.price||0),cantidad});
    }
    const profSnap=await db.collection('usuarios').doc(CURRENT_USER.uid).get();
    if(!profSnap.exists) throw new Error('No se encontró tu perfil.');
    const prof=profSnap.data();
    const total=fresh.reduce((a,i)=>a+(Number(i.price)*Number(i.cantidad)),0);
    const ref=db.collection('pedidos').doc();
    const numero='NDB-'+ref.id.slice(0,8).toUpperCase();
    await ref.set({
      numero, clienteUid:CURRENT_USER.uid,
      cliente:{business_name:String(prof.business_name||''),nombre:String(prof.nombre||''),email:String(prof.email||CURRENT_USER.email||''),phone:String(prof.phone||''),address:String(prof.address||''),neighborhood:String(prof.neighborhood||''),city:String(prof.city||'')},
      items:fresh,total,estado:'pendiente',observaciones:($('obs')?.value.trim()||'').slice(0,1000),
      createdAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    saveLocalCart([]); await downloadOrderPdf(ref.id);
    alert('Pedido confirmado. En breve nos comunicaremos con vos.'); location.href='cliente/mis-presupuestos.html';
  }catch(e){alert('No se pudo crear el pedido: '+(e?.message||e));}
  finally{if(btn){btn.disabled=false;btn.textContent='Confirmar pedido y descargar PDF';}}
}
async function getOrderFull(orderId){const snap=await db.collection('pedidos').doc(orderId).get();if(!snap.exists)throw new Error('Pedido no encontrado.');const order={id:snap.id,...snap.data()};return {order,items:order.items||[]};}
function imageToDataUrl(src){return new Promise(resolve=>{const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{try{const c=document.createElement('canvas');c.width=img.naturalWidth||img.width;c.height=img.naturalHeight||img.height;c.getContext('2d').drawImage(img,0,0);resolve(c.toDataURL('image/png'));}catch(e){resolve(null);}};img.onerror=()=>resolve(null);img.src=src;});}
function pdfSafe(v){return String(v??'').replace(/\s+/g,' ').trim();}
async function buildOrderPdf(orderId,kind='pedido'){
  if(!window.jspdf) throw new Error('No se pudo cargar el generador de PDF.');
  const {order,items}=await getOrderFull(orderId),{jsPDF}=window.jspdf,doc=new jsPDF({unit:'mm',format:'a4'});
  const isRemito=kind==='remito', title=isRemito?'REMITO':'PEDIDO';
  const pageW=210, left=15, right=195;
  const logo=await imageToDataUrl(rootPrefix()+'img/logo-completo.jpg');
  if(logo){try{doc.addImage(logo,'PNG',15,10,48,24,undefined,'FAST');}catch(e){}}
  doc.setDrawColor(229,37,42);doc.setLineWidth(.8);doc.line(left,38,right,38);
  doc.setFont('helvetica','bold');doc.setFontSize(20);doc.text(title,right,17,{align:'right'});
  doc.setFontSize(10);doc.setTextColor(80);doc.text(orderNumber(order),right,24,{align:'right'});doc.text(dateText(order.createdAt)||new Date().toLocaleString('es-AR'),right,30,{align:'right'});
  doc.setTextColor(20);doc.setFontSize(10);doc.setFont('helvetica','bold');doc.text('Cliente',left,47);doc.setFont('helvetica','normal');
  const client=pdfSafe(order.cliente?.business_name||order.cliente?.nombre||order.cliente?.email||'');
  doc.text(client,left,53);let cy=59;
  if(order.cliente?.email){doc.text('Email: '+pdfSafe(order.cliente.email),left,cy);cy+=5;}
  if(order.cliente?.phone){doc.text('Tel: '+pdfSafe(order.cliente.phone),left,cy);cy+=5;}
  if(order.cliente?.address){doc.text('Entrega: '+pdfSafe([order.cliente.address,order.cliente.neighborhood,order.cliente.city].filter(Boolean).join(', ')),left,cy);cy+=5;}
  let y=Math.max(cy+5,72);
  const header=()=>{doc.setFillColor(245,246,248);doc.rect(left,y,180,9,'F');doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text('Código',17,y+6);doc.text('Producto',45,y+6);doc.text('Cant.',145,y+6,{align:'right'});if(!isRemito){doc.text('Unit.',170,y+6,{align:'right'});doc.text('Subtotal',193,y+6,{align:'right'});}y+=12;};
  header();doc.setFont('helvetica','normal');doc.setFontSize(9);
  for(const i of items){
    const nameLines=doc.splitTextToSize(pdfSafe(i.product_name),88), rowH=Math.max(7,nameLines.length*4.2+2);
    if(y+rowH>275){doc.addPage();y=18;header();doc.setFont('helvetica','normal');doc.setFontSize(9);}
    doc.text(pdfSafe(i.product_code||''),17,y+4);doc.text(nameLines,45,y+4);doc.text(String(i.quantity),145,y+4,{align:'right'});
    if(!isRemito){doc.text(money(i.unit_price),170,y+4,{align:'right'});doc.text(money(Number(i.unit_price)*Number(i.quantity)),193,y+4,{align:'right'});}
    doc.setDrawColor(235);doc.line(left,y+rowH,right,y+rowH);y+=rowH+2;
  }
  if(!isRemito){y+=6;doc.setFont('helvetica','bold');doc.setFontSize(14);doc.text('TOTAL '+money(order.total),right,y,{align:'right'});y+=8;}
  if(order.observaciones){doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text('Observaciones',left,y+5);doc.setFont('helvetica','normal');const obs=doc.splitTextToSize(pdfSafe(order.observaciones),175);doc.text(obs,left,y+11);y+=11+obs.length*4;}
  if(isRemito){y=Math.max(y+12,235);doc.setDrawColor(140);doc.line(20,y,88,y);doc.line(122,y,190,y);doc.setFontSize(8);doc.setTextColor(90);doc.text('Preparó',54,y+5,{align:'center'});doc.text('Recibió / Firma',156,y+5,{align:'center'});}
  doc.setFontSize(8);doc.setTextColor(120);doc.text(`NDB Sanitarios · ${title} generado desde el sistema`,105,290,{align:'center'});
  return {doc,order};
}
async function downloadOrderPdf(orderId){try{const {doc,order}=await buildOrderPdf(orderId,'pedido');doc.save(`${orderNumber(order)}-pedido.pdf`);}catch(e){alert('No se pudo generar el PDF: '+e.message);}}
async function downloadRemitoPdf(orderId){try{const {doc,order}=await buildOrderPdf(orderId,'remito');doc.save(`${orderNumber(order)}-remito.pdf`);}catch(e){alert('No se pudo generar el remito: '+e.message);}}
async function renderMyOrders(){const cont=$('myQuotes');if(!cont)return;if(!(await requireUser('cliente')))return;try{const snap=await db.collection('pedidos').where('clienteUid','==',CURRENT_USER.uid).get();const data=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));cont.innerHTML=data.map(q=>`<div class="quote-item"><div class="row"><h3>${esc(orderNumber(q))}</h3><span class="status ${esc(q.estado)}">${esc(q.estado)}</span></div><p>${dateText(q.createdAt)}</p><p><b>Total:</b> ${money(q.total)}</p><div class="order-actions"><button class="btn btn-light" onclick="downloadOrderPdf('${q.id}')">Descargar PDF</button>${q.estado==='pendiente'?`<button class="btn btn-danger" onclick="cancelOrder('${q.id}')">Cancelar</button>`:''}</div></div>`).join('')||'<div class="empty">Todavía no tenés pedidos.</div>';}catch(e){console.error(e);cont.innerHTML='<div class="empty">No se pudieron cargar los pedidos.</div>';}}
async function cancelOrder(id){if(!confirm('¿Cancelar este pedido?'))return;try{const ref=db.collection('pedidos').doc(id),snap=await ref.get(),o=snap.data();if(o.clienteUid!==CURRENT_USER.uid||o.estado!=='pendiente')return alert('Solo podés cancelar pedidos pendientes.');await ref.update({estado:'cancelado',updatedAt:firebase.firestore.FieldValue.serverTimestamp()});await renderMyOrders();}catch(e){alert(e.message);}}
async function openEditOrder(id){const {order,items}=await getOrderFull(id);if(!['pendiente','preparacion'].includes(order.estado))return alert('Este pedido ya no se puede modificar.');const rows=items.map(i=>`<div class="edit-row"><div><b>${esc(i.product_name)}</b><div class="code">${esc(i.product_code||'')}</div></div><input class="field" id="edit-${i.product_id}" type="number" min="0" value="${i.quantity}"></div>`).join('');$('orderEditBody').innerHTML=rows;$('orderEditModal').classList.add('show');$('saveOrderEdit').onclick=()=>saveOrderEdit(id,items,order);}
function closeEditOrder(){$('orderEditModal')?.classList.remove('show');}
async function saveOrderEdit(){alert('Por seguridad, un pedido confirmado no puede cambiar productos ni importes. Cancelalo si todavía está pendiente y generá uno nuevo.');closeEditOrder();}

async function renderAdmin(){if(!$('adminQuotes'))return;if(!(await requireUser('admin')))return;await Promise.all([renderAdminOrders(),renderAdminProducts(),renderAdminClients(),renderDashboard()]);}
async function allOrders(){const snap=await db.collection('pedidos').get();return snap.docs.map(d=>({id:d.id,...d.data()}));}
async function renderDashboard(){if(!$('statPending'))return;const all=await allOrders();$('statPending').textContent=all.filter(x=>x.estado==='pendiente').length;$('statPrepared').textContent=all.filter(x=>x.estado==='preparacion').length;$('statDelivered').textContent=all.filter(x=>x.estado==='entregado').length;$('statTotal').textContent=money(all.filter(x=>x.estado!=='cancelado').reduce((a,x)=>a+Number(x.total||0),0));}
function statusLabel(s){return ({pendiente:'Pendiente',preparacion:'Preparado',entregado:'Entregado',cancelado:'Cancelado'})[s]||s;}
async function renderAdminOrders(){const all=(await allOrders()).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));const raw=$('adminStatusFilter')?.value||'Todos',map={Pendiente:'pendiente',Preparado:'preparacion',Entregado:'entregado',Cancelado:'cancelado'},filter=map[raw]||'Todos',q=($('adminOrderSearch')?.value||'').toLowerCase();const rows=all.filter(o=>(filter==='Todos'||o.estado===filter)&&(!q||`${o.numero||''} ${o.cliente?.business_name||''} ${o.cliente?.nombre||''} ${o.cliente?.email||''}`.toLowerCase().includes(q)));$('adminQuotes').innerHTML=rows.map(o=>`<div class="quote-item"><div class="row"><div><h3>${esc(orderNumber(o))}</h3><p>${esc(o.cliente?.business_name||o.cliente?.nombre||o.cliente?.email||'')}</p></div><span class="status ${esc(o.estado)}">${esc(statusLabel(o.estado))}</span></div><p>${dateText(o.createdAt)} · <b>${money(o.total)}</b></p><div class="order-actions wrap"><button class="btn btn-light" onclick="downloadOrderPdf('${o.id}')">Pedido PDF</button>${['preparacion','entregado'].includes(o.estado)?`<button class="btn btn-outline" onclick="downloadRemitoPdf('${o.id}')">Remito</button>`:''}<select class="field status-select" onchange="changeStatus('${o.id}',this.value)">${[['pendiente','Pendiente'],['preparacion','Preparado'],['entregado','Entregado'],['cancelado','Cancelado']].map(([v,l])=>`<option value="${v}" ${o.estado===v?'selected':''}>${l}</option>`).join('')}</select></div></div>`).join('')||'<div class="empty">No hay pedidos.</div>';}
async function changeStatus(id,status){try{const ref=db.collection('pedidos').doc(id),before=await ref.get(),prev=before.data()?.estado;await ref.update({estado:status,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});await renderAdminOrders();await renderDashboard();if(status==='preparacion'&&prev!=='preparacion'){await downloadRemitoPdf(id);}}catch(e){alert('No se pudo cambiar el estado: '+e.message);}}
function initAdminProductSelectors(){const brand=$('newProductBrand'),category=$('newProductCategory');if(brand&&!brand.dataset.ready){brand.innerHTML='<option value="">Marca *</option>'+NDB_BRANDS.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');brand.dataset.ready='1';}if(category&&!category.dataset.ready){category.innerHTML='<option value="">Tipo de producto *</option>'+NDB_TYPES.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');category.dataset.ready='1';}}
let NEW_PRODUCT_IMAGE_DATA = null;

function compressImageFile(file, maxSide=900, quality=.78){
  return new Promise((resolve,reject)=>{
    if(!file) return resolve(null);
    if(!file.type.startsWith('image/')) return reject(new Error('El archivo elegido no es una imagen.'));
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('No se pudo leer la imagen.'));
    reader.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error('No se pudo procesar la imagen.'));
      img.onload=()=>{
        let w=img.width,h=img.height;
        const scale=Math.min(1,maxSide/Math.max(w,h));
        w=Math.max(1,Math.round(w*scale)); h=Math.max(1,Math.round(h*scale));
        const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
        const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0,w,h);
        let data=canvas.toDataURL('image/jpeg',quality);
        if(data.length>700000) data=canvas.toDataURL('image/jpeg',.58);
        if(data.length>900000) return reject(new Error('La foto sigue siendo demasiado pesada. Elegí una imagen más chica.'));
        resolve(data);
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function previewProductImage(input){
  const file=input?.files?.[0];
  if(!file){clearProductImage();return;}
  try{
    NEW_PRODUCT_IMAGE_DATA=await compressImageFile(file);
    const img=$('newProductImagePreview'),wrap=$('newProductImagePreviewWrap');
    if(img) img.src=NEW_PRODUCT_IMAGE_DATA;
    if(wrap) wrap.classList.remove('hidden');
  }catch(e){clearProductImage();alert(e.message);}
}
function clearProductImage(){
  NEW_PRODUCT_IMAGE_DATA=null;
  const input=$('newProductImage'),wrap=$('newProductImagePreviewWrap'),img=$('newProductImagePreview');
  if(input) input.value=''; if(img) img.removeAttribute('src'); if(wrap) wrap.classList.add('hidden');
}

async function createAdminProduct(){if(!(await requireUser('admin')))return;const code=$('newProductCode')?.value.trim(),name=$('newProductName')?.value.trim(),brand=$('newProductBrand')?.value||'',category=$('newProductCategory')?.value||'',price=Number($('newProductPrice')?.value),stock=Number($('newProductStock')?.value),minStock=Number($('newProductMinStock')?.value||0),previousRaw=$('newProductPreviousPrice')?.value,previousPrice=previousRaw===''?null:Number(previousRaw);if(!code||!name||!brand||!category||!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0)return alert('Completá código, nombre, marca, tipo, precio y stock con valores válidos.');const payload={code,name,brand,category,price,stock,min_stock:Math.max(0,Math.trunc(minStock||0)),previous_price:Number.isFinite(previousPrice)?previousPrice:null,image_url:NEW_PRODUCT_IMAGE_DATA||null,description:$('newProductDescription')?.value.trim()||null,on_sale:!!$('newProductSale')?.checked,featured:false,active:true,createdAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()};const btn=$('createProductBtn');if(btn){btn.disabled=true;btn.textContent='Agregando...';}try{const dup=await db.collection('productos').where('code','==',code).get();if(!dup.empty)throw new Error('Ya existe un producto con ese código.');await db.collection('productos').add(payload);['newProductCode','newProductName','newProductPrice','newProductStock','newProductMinStock','newProductPreviousPrice','newProductDescription'].forEach(id=>{if($(id))$(id).value='';});clearProductImage();if($('newProductBrand'))$('newProductBrand').value='';if($('newProductCategory'))$('newProductCategory').value='';if($('newProductSale'))$('newProductSale').checked=false;alert('Producto agregado correctamente.');await renderAdminProducts();}catch(e){alert('No se pudo agregar el producto: '+e.message);}finally{if(btn){btn.disabled=false;btn.textContent='+ Agregar producto';}}}
function filteredAdminProducts(){const q=($('adminProductSearch')?.value||'').trim().toLowerCase(),sort=$('adminProductSort')?.value||'name-asc';let rows=PRODUCTS.filter(p=>!q||`${p.name||''} ${p.code||''}`.toLowerCase().includes(q));rows=[...rows];if(sort==='name-desc')rows.sort((a,b)=>String(b.name||'').localeCompare(String(a.name||''),'es'));else if(sort==='code-asc')rows.sort((a,b)=>String(a.code||'').localeCompare(String(b.code||''),'es',{numeric:true}));else rows.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'es'));return rows;}
function paintAdminProducts(){if(!$('adminProducts'))return;const rows=filteredAdminProducts();$('adminProducts').innerHTML=rows.map(p=>`<div class="admin-product-card"><div class="row"><div><h3>${esc(p.name)}</h3><div class="code">${esc(p.code||'')} ${p.brand?'· '+esc(p.brand):''}</div></div><span class="stock ${Number(p.stock)<=Number(p.min_stock||0)?'low-stock':''}">Stock ${p.stock}</span></div><label>Precio</label><input class="field" id="price-${p.id}" type="number" min="0" step="0.01" value="${p.price}"><label>Stock</label><input class="field" id="stock-${p.id}" type="number" min="0" value="${p.stock}"><label>Stock mínimo</label><input class="field" id="min-${p.id}" type="number" min="0" value="${p.min_stock||0}"><div class="check-row"><label><input id="sale-${p.id}" type="checkbox" ${p.on_sale?'checked':''}> Oferta</label><label><input id="featured-${p.id}" type="checkbox" ${p.featured?'checked':''}> Destacado</label></div><button class="btn btn-red full-btn" onclick="saveAdminProduct('${p.id}')">Guardar cambios</button></div>`).join('')||'<div class="empty">No se encontraron productos con esa búsqueda.</div>';}
async function renderAdminProducts(){initAdminProductSelectors();if(!$('adminProducts'))return;try{const snap=await db.collection('productos').get();PRODUCTS=snap.docs.map(normalizeProduct);paintAdminProducts();}catch(e){console.error(e);}}
async function saveAdminProduct(id){try{const payload={price:Number($('price-'+id).value),stock:Math.max(0,parseInt($('stock-'+id).value)||0),min_stock:Math.max(0,parseInt($('min-'+id).value)||0),on_sale:$('sale-'+id).checked,featured:$('featured-'+id).checked,updatedAt:firebase.firestore.FieldValue.serverTimestamp()};await db.collection('productos').doc(id).update(payload);alert('Producto actualizado.');await renderAdminProducts();}catch(e){alert('No se pudo guardar: '+e.message);}}

function catalogText(v){return String(v??'').replace(/\s+/g,' ').trim();}
function catalogSortProducts(rows,mode){
  const clean=v=>catalogText(v).toLocaleLowerCase('es');
  return [...rows].sort((x,y)=>{
    const xb=clean(x.brand||'Sin marca'), yb=clean(y.brand||'Sin marca');
    const xc=clean(x.category||'Sin categoría'), yc=clean(y.category||'Sin categoría');
    const xn=clean(x.name), yn=clean(y.name);
    if(mode==='category') return xc.localeCompare(yc,'es') || xb.localeCompare(yb,'es') || xn.localeCompare(yn,'es');
    if(mode==='brand') return xb.localeCompare(yb,'es') || xn.localeCompare(yn,'es');
    return xb.localeCompare(yb,'es') || xc.localeCompare(yc,'es') || xn.localeCompare(yn,'es');
  });
}
function catalogGroupLabel(p,mode){
  const brand=catalogText(p.brand||'Sin marca'), category=catalogText(p.category||'Sin categoría');
  if(mode==='brand') return brand;
  if(mode==='category') return category;
  return `${brand} · ${category}`;
}
async function catalogImageData(src){
  if(!src) return null;
  if(String(src).startsWith('data:image/')) return src;
  return await imageToDataUrl(src);
}
async function ensureJsPdf(){
  if(window.jspdf?.jsPDF) return true;
  const urls=[
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js'
  ];
  for(const src of urls){
    try{
      await new Promise((resolve,reject)=>{
        const old=[...document.scripts].find(x=>x.src===src);
        if(old){old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});setTimeout(()=>window.jspdf?.jsPDF?resolve():reject(),1800);return;}
        const el=document.createElement('script');el.src=src;el.onload=resolve;el.onerror=reject;document.head.appendChild(el);
      });
      if(window.jspdf?.jsPDF) return true;
    }catch(e){}
  }
  return false;
}
async function downloadCatalogPdf(){
  const btn=$('catalogPdfBtn');
  try{
    if(!(await requireUser('admin'))) return;
    if(!(await ensureJsPdf())) throw new Error('No se pudo cargar el generador de PDF. Revisá tu conexión y volvé a intentar.');
    btn.disabled=true; btn.textContent='Generando...';
    const snap=await db.collection('productos').get();
    let products=snap.docs.map(normalizeProduct).filter(p=>p.active!==false);
    if(!products.length) throw new Error('No hay productos activos para incluir.');
    const mode=$('catalogGroupBy')?.value||'brand-category';
    const perPage=12;
    const showPrices=!!$('catalogShowPrices')?.checked;
    products=catalogSortProducts(products,mode);
    const {jsPDF}=window.jspdf, doc=new jsPDF({unit:'mm',format:'a4'});
    const pageW=210,pageH=297,marginX=12,top=34,bottom=12,gapX=6,gapY=7;
    const cols=perPage===6?2:(perPage===12?3:2), rows=perPage===6?3:(perPage===12?4:4);
    const cardW=(pageW-marginX*2-gapX*(cols-1))/cols;
    const cardH=(pageH-top-bottom-gapY*(rows-1))/rows;
    const logo=await imageToDataUrl(rootPrefix()+'img/logo-completo.jpg');
    let pageNo=0, indexOnPage=0, lastGroup='';
    function pageHeader(group){
      pageNo++;
      if(logo){try{doc.addImage(logo,'PNG',12,8,36,18,undefined,'FAST');}catch(e){}}
      doc.setTextColor(20);doc.setFont('helvetica','bold');doc.setFontSize(16);doc.text('CATÁLOGO DE PRODUCTOS',198,14,{align:'right'});
      doc.setFontSize(9);doc.setTextColor(105);doc.text(group||'Productos',198,21,{align:'right'});
      doc.setDrawColor(229,37,42);doc.setLineWidth(.7);doc.line(12,27,198,27);
      doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(130);doc.text(`Página ${pageNo}`,198,292,{align:'right'});
      indexOnPage=0;
    }
    pageHeader(catalogGroupLabel(products[0],mode));
    for(let idx=0;idx<products.length;idx++){
      const p=products[idx], group=catalogGroupLabel(p,mode);
      if(indexOnPage>=perPage){doc.addPage();pageHeader(group);}
      const col=indexOnPage%cols,row=Math.floor(indexOnPage/cols),x=marginX+col*(cardW+gapX),y=top+row*(cardH+gapY);
      doc.setDrawColor(224);doc.setFillColor(255,255,255);doc.roundedRect(x,y,cardW,cardH,2.5,2.5,'FD');
      const pad=4,imgH=perPage===12?24:(perPage===8?29:35), imgW=cardW-pad*2;
      const img=await catalogImageData(p.image_url||rootPrefix()+'img/producto.jpg');
      if(img){try{
        const props=doc.getImageProperties(img), ratio=Math.min(imgW/props.width,imgH/props.height),w=props.width*ratio,h=props.height*ratio;
        doc.addImage(img,props.fileType||'JPEG',x+(cardW-w)/2,y+3+(imgH-h)/2,w,h,undefined,'FAST');
      }catch(e){}}
      let ty=y+imgH+6;
      doc.setFont('helvetica','bold');doc.setTextColor(28);doc.setFontSize(perPage===12?8:9.5);
      const name=doc.splitTextToSize(catalogText(p.name||'Producto'),cardW-pad*2).slice(0,2);doc.text(name,x+pad,ty);ty+=name.length*(perPage===12?3.4:4)+1;
      doc.setFont('helvetica','normal');doc.setFontSize(perPage===12?6.7:7.5);doc.setTextColor(105);
      doc.text(`Cód: ${catalogText(p.code||'-')}`,x+pad,ty);ty+=3.5;
      if(perPage!==12){doc.text(catalogText(p.brand||'Sin marca'),x+pad,ty);ty+=3.5;doc.text(catalogText(p.category||'Sin categoría'),x+pad,ty);ty+=3.5;}
      if(showPrices){doc.setFont('helvetica','bold');doc.setTextColor(229,37,42);doc.setFontSize(perPage===12?9:11);doc.text(money(Number(p.price||0)),x+pad,y+cardH-5);}
      doc.setFont('helvetica','normal');doc.setTextColor(Number(p.stock)>0?70:150);doc.setFontSize(6.5);doc.text(Number(p.stock)>0?`Stock: ${p.stock}`:'Sin stock',x+cardW-pad,y+cardH-5,{align:'right'});
      indexOnPage++;
      lastGroup=group;
    }
    const date=new Date().toLocaleDateString('es-AR').replaceAll('/','-');
    doc.save(`catalogo-productos-${date}.pdf`);
  }catch(e){alert('No se pudo generar el catálogo: '+e.message);}
  finally{if(btn){btn.disabled=false;btn.textContent='Generar PDF';}}
}

let ADMIN_CLIENTS=[];
async function renderAdminClients(){if(!$('adminClients'))return;try{const snap=await db.collection('usuarios').where('rol','==','cliente').get();ADMIN_CLIENTS=snap.docs.map(d=>({id:d.id,...d.data()}));paintAdminClients();}catch(e){console.error(e);$('adminClients').innerHTML='<div class="empty">No se pudieron cargar los clientes.</div>';}}
function paintAdminClients(){if(!$('adminClients'))return;const q=($('adminClientSearch')?.value||'').trim().toLowerCase(),sort=$('adminClientSort')?.value||'name-asc';let data=ADMIN_CLIENTS.filter(c=>!q||`${c.business_name||''} ${c.nombre||''} ${c.email||''} ${c.phone||''} ${c.city||''}`.toLowerCase().includes(q));data=[...data];if(sort==='name-desc')data.sort((a,b)=>String(b.business_name||b.nombre||b.email||'').localeCompare(String(a.business_name||a.nombre||a.email||''),'es'));else if(sort==='recent')data.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));else data.sort((a,b)=>String(a.business_name||a.nombre||a.email||'').localeCompare(String(b.business_name||b.nombre||b.email||''),'es'));$('adminClients').innerHTML=data.map(c=>`<article class="admin-client-card"><div class="admin-client-main"><div class="client-avatar">${esc((c.business_name||c.nombre||c.email||'C').trim().charAt(0).toUpperCase())}</div><div class="client-copy"><div class="row client-title-row"><h3>${esc(c.business_name||c.nombre||c.email||'Cliente')}</h3><span class="status client-status">Activo</span></div>${c.nombre&&c.business_name?`<p class="client-person">${esc(c.nombre)}</p>`:''}<div class="client-meta">${c.email?`<span>✉ ${esc(c.email)}</span>`:''}${c.phone?`<span>☎ ${esc(c.phone)}</span>`:''}${c.city?`<span>⌖ ${esc(c.city)}</span>`:''}${Number(c.discount_percent||0)>0?`<span>Descuento ${Number(c.discount_percent)}%</span>`:''}</div></div></div><div class="client-actions"><button class="btn btn-danger" onclick="deleteClient('${c.id}','${esc(String(c.business_name||c.nombre||c.email||'Cliente')).replace(/'/g,'&#39;')}')">Eliminar cliente</button></div></article>`).join('')||'<div class="empty">No se encontraron clientes.</div>';}
async function deleteClient(id,name){
  if(!(await requireUser('admin')))return;
  if(!confirm(`¿Desactivar a ${name}?\n\nNo podrá ingresar a las áreas privadas. Sus pedidos históricos se conservan.`))return;
  try{
    await db.collection('usuarios').doc(id).update({active:false,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    ADMIN_CLIENTS=ADMIN_CLIENTS.map(c=>c.id===id?{...c,active:false}:c); paintAdminClients();
    alert('Cliente desactivado. En el plan gratuito Spark no se puede borrar de Authentication de forma segura desde el navegador.');
  }catch(e){alert('No se pudo desactivar el cliente: '+(e?.message||e));}
}
async function createClient(){
  if(!(await requireUser('admin')))return;
  const email=$('newClientEmail')?.value.trim().toLowerCase(),password=$('newClientPassword')?.value||'',business_name=$('newClientBusiness')?.value.trim(),nombre=$('newClientName')?.value.trim(),phone=$('newClientPhone')?.value.trim(),city=$('newClientCity')?.value.trim(),discount_percent=Math.max(0,Math.min(100,Number($('newClientDiscount')?.value||0)));
  if(!business_name||!email||password.length<8)return alert('Completá razón social, email y una contraseña de al menos 8 caracteres.');
  if(!/^\S+@\S+\.\S+$/.test(email))return alert('Ingresá un email válido.');
  const btn=$('createClientBtn');if(btn){btn.disabled=true;btn.textContent='Creando...';}
  let secondary=null;
  try{
    // App secundaria: crea al cliente sin cerrar la sesión del administrador.
    const appName='clientCreator';
    secondary=firebase.apps.find(a=>a.name===appName)||firebase.initializeApp(window.NDB_CONFIG.firebaseConfig,appName);
    const secondaryAuth=secondary.auth();
    const cred=await secondaryAuth.createUserWithEmailAndPassword(email,password);
    const uid=cred.user.uid;
    await secondary.firestore().collection('usuarios').doc(uid).set({
      business_name:business_name.slice(0,120),nombre:nombre.slice(0,120),email,
      phone:phone.slice(0,40),address:'',neighborhood:'',city:city.slice(0,100),
      discount_percent,rol:'cliente',active:true,
      createdAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    await secondaryAuth.signOut();
    ['newClientEmail','newClientPassword','newClientBusiness','newClientName','newClientPhone','newClientCity'].forEach(id=>{if($(id))$(id).value='';});if($('newClientDiscount'))$('newClientDiscount').value='0';
    alert('Cliente creado correctamente. Ya puede ingresar desde la página.');await renderAdminClients();
  }catch(e){try{if(secondary)await secondary.auth().signOut();}catch(_){} alert('No se pudo crear el cliente: '+(e?.message||e));}
  finally{if(btn){btn.disabled=false;btn.textContent='+ Agregar cliente';}}
}

function showAdminSection(id){document.querySelectorAll('.admin-section').forEach(s=>s.classList.add('hidden'));$(id)?.classList.remove('hidden');document.querySelectorAll('[data-section]').forEach(b=>b.classList.toggle('active',b.dataset.section===id));}

window.addEventListener('DOMContentLoaded',async()=>{
  configWarning();updateCartCount();renderCart();showLogoutConfirmation();

  // El catálogo público se carga inmediatamente y NO espera a Authentication.
  if($('products')||$('offers')||$('featured')) await loadProducts();

  // Las áreas privadas sí esperan el estado de sesión.
  if($('loginPage')||$('profilePage')||$('clientName')||$('myQuotes')||$('adminQuotes')||$('adminProducts')||$('adminClients')){
    await waitForAuth();
  }
  if($('loginPage'))await redirectIfLogged();
  if($('profilePage')||$('clientName'))await loadProfile();
  if($('myQuotes'))await renderMyOrders();
  if($('adminQuotes'))await renderAdmin();
  if($('adminProducts') && !$('adminQuotes')){ if(await requireUser('admin')) await renderAdminProducts(); }
  if($('adminClients') && !$('adminQuotes')){ if(await requireUser('admin')) await renderAdminClients(); }
});
