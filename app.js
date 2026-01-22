// ---------- Simple local DB ----------
const KEY = "ct_v1";
const todayKey = () => new Date().toISOString().slice(0,10);

function loadDB(){
  const raw = localStorage.getItem(KEY);
  if(raw) return JSON.parse(raw);
  return {
    settings: { goal: 0, proteinGoal: 0 },
    foods: [],
    templates: [],
    templateItems: [], // {id, templateId, foodId, servings}
    entries: [] // {id, dateKey, type: "food"|"quick", foodId?, servings?, quickCalories?, ts}
  };
}
function saveDB(db){ localStorage.setItem(KEY, JSON.stringify(db)); }

function uid(){ return crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now(); }

// ---------- UI Helpers ----------
const $ = (sel) => document.querySelector(sel);

function fmtDate(dateKey){
  const [y,m,d] = dateKey.split("-").map(Number);
  return new Date(y, m-1, d).toLocaleDateString(undefined, { weekday:"long", month:"short", day:"numeric" });
}

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    $("#tab-"+btn.dataset.tab).classList.add("active");
    renderAll();
  });
});

// ---------- Modal ----------
function openModal(title, bodyEl){
  $("#modalTitle").textContent = title;
  const body = $("#modalBody");
  body.innerHTML = "";
  body.appendChild(bodyEl);
  $("#modalBackdrop").classList.remove("hidden");
}
function closeModal(){ $("#modalBackdrop").classList.add("hidden"); }
$("#modalClose").addEventListener("click", closeModal);
$("#modalBackdrop").addEventListener("click", (e)=>{ if(e.target.id==="modalBackdrop") closeModal(); });

// ---------- Rendering ----------
function renderAll(){
  const db = loadDB();
  renderToday(db);
  renderFoods(db);
  renderTemplates(db);
  renderSettings(db);
}

function renderToday(db){
  const dk = todayKey();
  $("#todayDate").textContent = fmtDate(dk);
  $("#goalDisplay").textContent = db.settings.goal ? String(db.settings.goal) : "—";

  const todays = db.entries.filter(e=>e.dateKey===dk).sort((a,b)=>b.ts-a.ts);
  const totals = calcTotals(db, todays);

  $("#calTotal").textContent = String(totals.calories);
  $("#pTotal").textContent = `${totals.protein} g`;
  const remaining = Math.max(0, (db.settings.goal||0) - totals.calories);
  $("#calRemaining").textContent = db.settings.goal ? String(remaining) : "—";
  const pRem = Math.max(0, (db.settings.proteinGoal || 0) - totals.protein);
$("#pRemaining").textContent = db.settings.proteinGoal ? `${pRem} g` : "—";

  const list = $("#entriesList");
  list.innerHTML = "";
  $("#emptyEntries").style.display = todays.length ? "none" : "block";

  todays.forEach(e=>{
    const el = document.createElement("div");
    el.className = "item";

    let title = "";
    let sub = "";
    let cal = 0;

    if(e.type==="quick"){
      title = "Quick Add";
      sub = "Manual calories";
      cal = e.quickCalories || 0;
    } else {
      const food = db.foods.find(f=>f.id===e.foodId);
      title = food ? food.name : "Unknown food";
      const servings = e.servings ?? 1;
      sub = `${servings} × ${food?.servingLabel || "serving"}`;
      cal = Math.round((food?.caloriesPerServing || 0) * servings);
    }

    el.innerHTML = `
      <div>
        <div class="title">${escapeHtml(title)}</div>
        <div class="sub">${escapeHtml(sub)}</div>
      </div>
      <div class="right">
        <div class="title">${cal} cal</div>
        <div class="sub"><button class="ghost" data-del="${e.id}">Delete</button></div>
      </div>
    `;
    list.appendChild(el);
  });

  list.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-del");
      const db2 = loadDB();
      db2.entries = db2.entries.filter(x=>x.id!==id);
      saveDB(db2);
      renderAll();
    });
  });
}

function renderFoods(db){
  const q = ($("#foodSearch").value || "").toLowerCase().trim();
  const foods = db.foods
    .filter(f => !q || f.name.toLowerCase().includes(q))
    .sort((a,b)=>a.name.localeCompare(b.name));

  const list = $("#foodsList");
  list.innerHTML = "";
  $("#emptyFoods").style.display = db.foods.length ? "none" : "block";

  foods.forEach(f=>{
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div>
        <div class="title">${escapeHtml(f.name)}</div>
        <div class="sub">${f.caloriesPerServing} cal per ${escapeHtml(f.servingLabel || "serving")}</div>
      </div>
      <div class="right">
        <button data-add="${f.id}">Add</button>
      </div>
    `;
    list.appendChild(el);
  });

  list.querySelectorAll("[data-add]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const foodId = btn.getAttribute("data-add");
      openAddToTodayModal(foodId);
    });
  });
}

function renderTemplates(db){
  const list = $("#templatesList");
  list.innerHTML = "";
  $("#emptyTemplates").style.display = db.templates.length ? "none" : "block";

  db.templates.forEach(t=>{
    const items = db.templateItems.filter(i=>i.templateId===t.id);
    const cal = Math.round(items.reduce((sum, it)=>{
      const food = db.foods.find(f=>f.id===it.foodId);
      return sum + (food?.caloriesPerServing||0) * (it.servings||1);
    }, 0));

    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div>
        <div class="title">${escapeHtml(t.name)}</div>
        <div class="sub">${items.length} items • ~${cal} cal</div>
      </div>
      <div class="right">
        <button data-use="${t.id}">Add to Today</button>
        <button class="ghost" data-edit="${t.id}">Edit</button>
      </div>
    `;
    list.appendChild(el);
  });

  list.querySelectorAll("[data-use]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const templateId = btn.getAttribute("data-use");
      const db2 = loadDB();
      const dk = todayKey();
      const items = db2.templateItems.filter(i=>i.templateId===templateId);

      items.forEach(it=>{
        db2.entries.push({
          id: uid(),
          dateKey: dk,
          type: "food",
          foodId: it.foodId,
          servings: it.servings || 1,
          ts: Date.now()
        });
      });
      saveDB(db2);
      // switch to Today tab
      document.querySelector('[data-tab="today"]').click();
    });
  });

  list.querySelectorAll("[data-edit]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const templateId = btn.getAttribute("data-edit");
      openEditTemplateModal(templateId);
    });
  });
}

function renderSettings(db){
  $("#goalInput").value = db.settings.goal || "";
  $("#proteinGoalInput").value = db.settings.proteinGoal || "";
}


// ---------- Calculations ----------
function calcTotals(db, entries){
  let calories = 0;
  let protein = 0;

  for(const e of entries){
    if(e.type==="quick"){
      calories += (e.quickCalories || 0);
    } else {
      const food = db.foods.find(f=>f.id===e.foodId);
      const s = (e.servings || 1);
      calories += (food?.caloriesPerServing || 0) * s;
      protein += (food?.proteinPerServing || 0) * s;
    }
  }

  return {
    calories: Math.round(calories),
    protein: Math.round(protein * 10) / 10
  };
}


// ---------- Actions ----------
$("#foodSearch").addEventListener("input", renderAll);

$("#btnSaveSettings").addEventListener("click", ()=>{
  const db = loadDB();

  const calGoal = parseInt($("#goalInput").value || "0", 10);
  db.settings.goal = Number.isFinite(calGoal) ? Math.max(0, calGoal) : 0;

  const pGoal = parseInt($("#proteinGoalInput").value || "0", 10);
  db.settings.proteinGoal = Number.isFinite(pGoal) ? Math.max(0, pGoal) : 0;

  saveDB(db);
  renderAll();
});

$("#btnReset").addEventListener("click", ()=>{
  if(confirm("Delete all data on this device?")){
    localStorage.removeItem(KEY);
    renderAll();
  }
});

$("#btnNewFood").addEventListener("click", openNewFoodModal);
$("#btnAddFoodToToday").addEventListener("click", ()=> openPickFoodModal("Add Food"));
$("#btnQuickAdd").addEventListener("click", openQuickAddModal);
$("#btnNewTemplate").addEventListener("click", openNewTemplateModal);
$("#btnAddTemplateToToday").addEventListener("click", openPickTemplateModal);

// ---------- Modals ----------
function openNewFoodModal(){
  const wrap = document.createElement("div");

  wrap.innerHTML = `
    <label class="field"><span>Name</span><input class="input" id="f_name" placeholder="e.g., Chicken thighs"/></label>
    <label class="field"><span>Calories per serving</span><input class="input" id="f_cal" type="number" min="0" step="1" placeholder="e.g., 150"/></label>
    <label class="field"><span>Protein (g) per serving</span>
  <input class="input" id="f_p" type="number" min="0" step="0.1" placeholder="e.g., 25"/>
</label>
    <label class="field"><span>Serving label</span><input class="input" id="f_label" placeholder="e.g., 1 thigh, 100g, 1 scoop"/></label>
    <div class="actions" style="margin-top:12px;">
      <button id="f_save">Save</button>
      <button class="ghost" id="f_cancel">Cancel</button>
    </div>
  `;

  wrap.querySelector("#f_cancel").addEventListener("click", closeModal);
  wrap.querySelector("#f_save").addEventListener("click", ()=>{
    const name = wrap.querySelector("#f_name").value.trim();
    const cal = parseInt(wrap.querySelector("#f_cal").value || "0", 10);
    const label = wrap.querySelector("#f_label").value.trim() || "serving";
    if(!name) return alert("Food name is required.");

    const db = loadDB();
    const p = parseFloat(wrap.querySelector("#f_p").value || "0");
    db.foods.push({
  id: uid(),
  name,
  caloriesPerServing: Math.max(0, cal||0),
  proteinPerServing: Math.max(0, Number.isFinite(p) ? p : 0),
  servingLabel: label
});

    saveDB(db);
    closeModal();
    renderAll();
  });

  openModal("New Food", wrap);
}

function openPickFoodModal(title){
  const db = loadDB();
  const wrap = document.createElement("div");

  const select = document.createElement("select");
  select.className = "input";
  db.foods.sort((a,b)=>a.name.localeCompare(b.name)).forEach(f=>{
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = `${f.name} (${f.caloriesPerServing} cal/${f.servingLabel||"serving"})`;
    select.appendChild(opt);
  });

  const servings = document.createElement("input");
  servings.className = "input";
  servings.type = "number";
  servings.min = "0";
  servings.step = "0.25";
  servings.value = "1";

  wrap.appendChild(labelWrap("Food", select));
  wrap.appendChild(labelWrap("Servings", servings));

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.style.marginTop = "12px";
  actions.innerHTML = `<button id="ok">Add</button><button class="ghost" id="cancel">Cancel</button>`;
  wrap.appendChild(actions);

  actions.querySelector("#cancel").addEventListener("click", closeModal);
  actions.querySelector("#ok").addEventListener("click", ()=>{
    if(db.foods.length===0) return alert("Add a food first.");
    const db2 = loadDB();
    db2.entries.push({
      id: uid(),
      dateKey: todayKey(),
      type: "food",
      foodId: select.value,
      servings: Math.max(0, parseFloat(servings.value||"1")),
      ts: Date.now()
    });
    saveDB(db2);
    closeModal();
    renderAll();
  });

  openModal(title, wrap);
}

function openAddToTodayModal(foodId){
  const db = loadDB();
  const food = db.foods.find(f=>f.id===foodId);
  if(!food) return;

  const wrap = document.createElement("div");
  const servings = document.createElement("input");
  servings.className = "input";
  servings.type = "number";
  servings.min = "0";
  servings.step = "0.25";
  servings.value = "1";

  wrap.appendChild(document.createTextNode(`${food.name} (${food.caloriesPerServing} cal per ${food.servingLabel})`));
  wrap.appendChild(document.createElement("div")).style.height="10px";
  wrap.appendChild(labelWrap("Servings", servings));

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.style.marginTop = "12px";
  actions.innerHTML = `<button id="ok">Add</button><button class="ghost" id="cancel">Cancel</button>`;
  wrap.appendChild(actions);

  actions.querySelector("#cancel").addEventListener("click", closeModal);
  actions.querySelector("#ok").addEventListener("click", ()=>{
    const db2 = loadDB();
    db2.entries.push({
      id: uid(),
      dateKey: todayKey(),
      type: "food",
      foodId,
      servings: Math.max(0, parseFloat(servings.value||"1")),
      ts: Date.now()
    });
    saveDB(db2);
    closeModal();
    renderAll();
  });

  openModal("Add to Today", wrap);
}

function openQuickAddModal(){
  const wrap = document.createElement("div");
  const cal = document.createElement("input");
  cal.className = "input";
  cal.type = "number";
  cal.min = "0";
  cal.step = "1";
  cal.placeholder = "e.g., 300";

  wrap.appendChild(labelWrap("Calories", cal));

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.style.marginTop = "12px";
  actions.innerHTML = `<button id="ok">Add</button><button class="ghost" id="cancel">Cancel</button>`;
  wrap.appendChild(actions);

  actions.querySelector("#cancel").addEventListener("click", closeModal);
  actions.querySelector("#ok").addEventListener("click", ()=>{
    const v = parseInt(cal.value || "0", 10);
    if(!Number.isFinite(v) || v<=0) return alert("Enter calories > 0");
    const db = loadDB();
    db.entries.push({ id: uid(), dateKey: todayKey(), type:"quick", quickCalories: v, ts: Date.now() });
    saveDB(db);
    closeModal();
    renderAll();
  });

  openModal("Quick Add", wrap);
}

function openNewTemplateModal(){
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <label class="field"><span>Template name</span><input class="input" id="t_name" placeholder="e.g., Breakfast"/></label>
    <div class="actions" style="margin-top:12px;">
      <button id="t_save">Create</button>
      <button class="ghost" id="t_cancel">Cancel</button>
    </div>
  `;
  wrap.querySelector("#t_cancel").addEventListener("click", closeModal);
  wrap.querySelector("#t_save").addEventListener("click", ()=>{
    const name = wrap.querySelector("#t_name").value.trim();
    if(!name) return alert("Name required.");
    const db = loadDB();
    db.templates.push({ id: uid(), name });
    saveDB(db);
    closeModal();
    renderAll();
  });
  openModal("New Template", wrap);
}

function openEditTemplateModal(templateId){
  const db = loadDB();
  const t = db.templates.find(x=>x.id===templateId);
  if(!t) return;

  const wrap = document.createElement("div");
  const title = document.createElement("div");
  title.className = "muted";
  title.textContent = "Add foods to this template:";
  wrap.appendChild(title);

  // picker
  const select = document.createElement("select");
  select.className = "input";
  db.foods.sort((a,b)=>a.name.localeCompare(b.name)).forEach(f=>{
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = `${f.name} (${f.caloriesPerServing} cal/${f.servingLabel||"serving"})`;
    select.appendChild(opt);
  });
  const servings = document.createElement("input");
  servings.className = "input";
  servings.type = "number";
  servings.min = "0";
  servings.step = "0.25";
  servings.value = "1";

  wrap.appendChild(labelWrap("Food", select));
  wrap.appendChild(labelWrap("Servings", servings));

  const addBtn = document.createElement("button");
  addBtn.textContent = "Add item";
  addBtn.style.marginTop = "10px";
  wrap.appendChild(addBtn);

  const list = document.createElement("div");
  list.className = "list";
  wrap.appendChild(list);

  function redraw(){
    const db2 = loadDB();
    const items = db2.templateItems.filter(i=>i.templateId===templateId);
    list.innerHTML = "";
    items.forEach(it=>{
      const food = db2.foods.find(f=>f.id===it.foodId);
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div>
          <div class="title">${escapeHtml(food?.name || "Unknown")}</div>
          <div class="sub">${it.servings} × ${escapeHtml(food?.servingLabel || "serving")}</div>
        </div>
        <div class="right">
          <button class="ghost" data-del="${it.id}">Delete</button>
        </div>
      `;
      list.appendChild(el);
    });

    list.querySelectorAll("[data-del]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.getAttribute("data-del");
        const db3 = loadDB();
        db3.templateItems = db3.templateItems.filter(x=>x.id!==id);
        saveDB(db3);
        redraw();
        renderAll();
      });
    });
  }

  addBtn.addEventListener("click", ()=>{
    const db2 = loadDB();
    if(db2.foods.length===0) return alert("Add foods first.");
    db2.templateItems.push({
      id: uid(),
      templateId,
      foodId: select.value,
      servings: Math.max(0, parseFloat(servings.value||"1"))
    });
    saveDB(db2);
    redraw();
    renderAll();
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.style.marginTop = "12px";
  actions.innerHTML = `<button class="ghost" id="done">Done</button>`;
  wrap.appendChild(actions);
  actions.querySelector("#done").addEventListener("click", closeModal);

  redraw();
  openModal(`Edit: ${t.name}`, wrap);
}

function openPickTemplateModal(){
  const db = loadDB();
  if(db.templates.length===0) return alert("Create a template first.");

  const wrap = document.createElement("div");
  const select = document.createElement("select");
  select.className = "input";
  db.templates.forEach(t=>{
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    select.appendChild(opt);
  });

  wrap.appendChild(labelWrap("Template", select));

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.style.marginTop = "12px";
  actions.innerHTML = `<button id="ok">Add to Today</button><button class="ghost" id="cancel">Cancel</button>`;
  wrap.appendChild(actions);

  actions.querySelector("#cancel").addEventListener("click", closeModal);
  actions.querySelector("#ok").addEventListener("click", ()=>{
    const templateId = select.value;
    const db2 = loadDB();
    const items = db2.templateItems.filter(i=>i.templateId===templateId);
    items.forEach(it=>{
      db2.entries.push({ id: uid(), dateKey: todayKey(), type:"food", foodId: it.foodId, servings: it.servings || 1, ts: Date.now() });
    });
    saveDB(db2);
    closeModal();
    renderAll();
  });

  openModal("Add Template", wrap);
}

// ---------- Utils ----------
function labelWrap(label, inputEl){
  const wrap = document.createElement("label");
  wrap.className = "field";
  const span = document.createElement("span");
  span.textContent = label;
  wrap.appendChild(span);
  wrap.appendChild(inputEl);
  return wrap;
}
function escapeHtml(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

// Initial render
renderAll();
