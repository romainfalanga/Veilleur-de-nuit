(() => {
  "use strict";

  // --- Planning du service ---
  // Les minutes depuis 19:30 sont comptées pour gérer le passage minuit.
  // start/end sont au format "HH:MM".
  const SCHEDULE = [
    {
      id: "transmission-caisse",
      start: "19:30",
      end: "19:45",
      title: "Transmission & Caisse",
      desc: "Point avec l'équipe de jour et vérification du fond de caisse.",
      tag: "Début de service",
      alert: true,
    },
    {
      id: "robot-piscine-pose",
      start: "19:45",
      end: "20:00",
      title: "Robot & Espace Piscine",
      desc: "Mise en place du robot de nettoyage et vérification/rangement de l'ensemble de l'espace piscine.",
      tag: "Début de service",
      alert: true,
    },
    {
      id: "reception-admin",
      start: "20:00",
      end: "00:00",
      title: "Réception & Gestion Administrative",
      desc: "Accueil et arrivées tardives. Classement des réservations du lendemain et tâches annexes prévues.",
      tag: "Réception",
      alert: true,
    },
    {
      id: "ronde-1",
      start: "00:00",
      end: "01:00",
      title: "Ronde de sécurité n°1",
      desc: "Réalisation complète d'une ronde intérieure et d'une ronde extérieure.",
      tag: "Sécurité",
      alert: true,
    },
    {
      id: "veille",
      start: "01:00",
      end: "04:00",
      title: "Veille & Présence",
      desc: "Présence à l'accueil pour la surveillance nocturne (réception légère).",
      tag: "Veille",
      alert: true,
    },
    {
      id: "robot-recup",
      start: "04:00",
      end: "04:15",
      title: "Récupération du robot piscine",
      desc: "Retirer et ranger le robot de nettoyage de la piscine.",
      tag: "Piscine",
      alert: true,
    },
    {
      id: "ronde-2",
      start: "04:15",
      end: "05:00",
      title: "Ronde de sécurité n°2",
      desc: "Seconde ronde complète : intérieure et extérieure.",
      tag: "Sécurité",
      alert: true,
    },
    {
      id: "petit-dejeuner",
      start: "05:00",
      end: "06:00",
      title: "Mise en place du Petit-Déjeuner",
      desc: "Préparer et dresser le buffet du petit-déjeuner.",
      tag: "Petit-déjeuner",
      alert: true,
    },
    {
      id: "accueil-transmission",
      start: "06:00",
      end: "07:30",
      title: "Accueil & Transmission",
      desc: "Accueil des premiers clients. Passation des consignes avec l'équipe montante. Vérification finale du fond de caisse.",
      tag: "Clôture",
      alert: true,
    },
    {
      id: "fin-service",
      start: "07:30",
      end: "07:30",
      title: "Fin de la journée de travail",
      desc: "Quitter le service après passation.",
      tag: "Fin",
      alert: true,
      instant: true,
    },
  ];

  // --- Utilitaires temps ---
  const SHIFT_ANCHOR_HOUR = 19;
  const SHIFT_ANCHOR_MIN = 30;

  const parseHM = (hm) => {
    const [h, m] = hm.split(":").map(Number);
    return { h, m };
  };

  const minutesFromAnchor = (h, m) => {
    const shift = (h * 60 + m) - (SHIFT_ANCHOR_HOUR * 60 + SHIFT_ANCHOR_MIN);
    return shift < 0 ? shift + 24 * 60 : shift;
  };

  // Renvoie la Date absolue correspondant à un "HH:MM" dans le contexte du service courant.
  const shiftDateFor = (hm, shiftStartDate) => {
    const { h, m } = parseHM(hm);
    const d = new Date(shiftStartDate);
    const offsetMin = minutesFromAnchor(h, m);
    d.setMinutes(d.getMinutes() + offsetMin);
    d.setSeconds(0, 0);
    return d;
  };

  // Détermine la date de "début du service en cours" (19:30 du soir courant ou précédent).
  const getShiftStart = (now = new Date()) => {
    const d = new Date(now);
    d.setSeconds(0, 0);
    const anchor = new Date(d);
    anchor.setHours(SHIFT_ANCHOR_HOUR, SHIFT_ANCHOR_MIN, 0, 0);
    // Si on est avant 19:30, on considère que le service en cours a commencé hier à 19:30
    // (utile pour la matinée après minuit). On ne considère ça que jusqu'à 12:00 max après le service.
    if (d < anchor) {
      // Si on est entre 00:00 et 12:00, on est probablement encore dans le service d'hier
      // Sinon (entre 12:00 et 19:30) on prépare le service du soir.
      if (d.getHours() >= 12) {
        return anchor; // service du soir à venir / en cours
      }
      const yest = new Date(anchor);
      yest.setDate(yest.getDate() - 1);
      return yest;
    }
    return anchor;
  };

  const shiftKey = (shiftStart) => {
    const y = shiftStart.getFullYear();
    const m = String(shiftStart.getMonth() + 1).padStart(2, "0");
    const d = String(shiftStart.getDate()).padStart(2, "0");
    return `shift-${y}-${m}-${d}`;
  };

  const fmtHM = (date) => {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  };

  const fmtDuration = (ms) => {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `dans ${h} h ${String(m).padStart(2, "0")}`;
    if (m > 0) return `dans ${m} min ${String(s).padStart(2, "0")} s`;
    return `dans ${s} s`;
  };

  // --- State ---
  let currentShiftStart = getShiftStart();
  let currentShiftKey = shiftKey(currentShiftStart);
  let storageState = loadState(currentShiftKey);
  let alarmAudio = null;
  let alarmAudioCtx = null;
  let alarmInterval = null;
  let alarmQueue = []; // files des alertes à déclencher

  const els = {
    clockTime: document.getElementById("clock-time"),
    clockDate: document.getElementById("clock-date"),
    currentTask: document.getElementById("current-task"),
    currentRange: document.getElementById("current-range"),
    nextTask: document.getElementById("next-task"),
    nextCountdown: document.getElementById("next-countdown"),
    progressText: document.getElementById("progress-text"),
    progressFill: document.getElementById("progress-fill"),
    timeline: document.getElementById("timeline"),
    notes: document.getElementById("notes"),
    alarmOverlay: document.getElementById("alarm-overlay"),
    alarmTitle: document.getElementById("alarm-title"),
    alarmMessage: document.getElementById("alarm-message"),
    alarmAck: document.getElementById("alarm-acknowledge"),
    alarmSnooze: document.getElementById("alarm-snooze"),
    testAlarm: document.getElementById("test-alarm"),
    stopAlarm: document.getElementById("stop-alarm"),
    enableNotifs: document.getElementById("enable-notifs"),
    resetShift: document.getElementById("reset-shift"),
  };

  // --- Persistence ---
  function loadState(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed };
    } catch {
      return defaultState();
    }
  }

  function defaultState() {
    return {
      done: {},        // { [taskId]: ISOString }
      fired: {},       // { [taskId]: true } -> alerte déjà sonnée
      snoozeUntil: {}, // { [taskId]: timestamp }
      notes: "",
    };
  }

  function saveState() {
    try {
      localStorage.setItem(currentShiftKey, JSON.stringify(storageState));
    } catch {
      // ignore
    }
  }

  // --- Rendu ---
  function buildSchedule() {
    const tasks = SCHEDULE.map((t) => {
      const startDate = shiftDateFor(t.start, currentShiftStart);
      const endDate = t.instant
        ? startDate
        : shiftDateFor(t.end, currentShiftStart);
      // Si end <= start à cause du cycle, on ajoute 24h (sécurité)
      if (endDate < startDate) endDate.setDate(endDate.getDate() + 1);
      return { ...t, startDate, endDate };
    });
    return tasks;
  }

  function renderTimeline(tasks, now) {
    els.timeline.innerHTML = "";
    for (const t of tasks) {
      const li = document.createElement("li");
      li.className = "task";
      li.dataset.id = t.id;

      const isDone = Boolean(storageState.done[t.id]);
      const isCurrent = now >= t.startDate && (t.instant ? now < new Date(t.startDate.getTime() + 60_000) : now < t.endDate);
      const isPast = !isCurrent && now >= t.endDate && !t.instant;
      const isPastInstant = t.instant && now >= new Date(t.startDate.getTime() + 60_000);
      const soonMs = t.startDate - now;
      const isSoon = !isCurrent && !isDone && soonMs > 0 && soonMs <= 15 * 60 * 1000;

      if (isDone) li.classList.add("done");
      if (isCurrent) li.classList.add("current");
      if ((isPast || isPastInstant) && !isDone) li.classList.add("past");
      if (isSoon) li.classList.add("upcoming-soon");

      const timeEl = document.createElement("div");
      timeEl.className = "task-time";
      timeEl.textContent = t.instant ? t.start : `${t.start} → ${t.end}`;

      const body = document.createElement("div");
      body.className = "task-body";
      const title = document.createElement("div");
      title.className = "task-title";
      title.textContent = t.title;
      const desc = document.createElement("div");
      desc.className = "task-desc";
      desc.textContent = t.desc;
      const meta = document.createElement("div");
      meta.className = "task-meta";
      if (t.tag) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = t.tag;
        meta.appendChild(tag);
      }
      if (isDone) {
        const when = document.createElement("span");
        when.className = "tag";
        when.textContent = `✓ Fait à ${new Date(storageState.done[t.id]).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
        meta.appendChild(when);
      }
      body.appendChild(title);
      body.appendChild(desc);
      body.appendChild(meta);

      const check = document.createElement("label");
      check.className = "task-check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = isDone;
      cb.setAttribute("aria-label", `Marquer "${t.title}" comme fait`);
      cb.addEventListener("change", () => {
        if (cb.checked) {
          storageState.done[t.id] = new Date().toISOString();
        } else {
          delete storageState.done[t.id];
        }
        saveState();
        update();
      });
      check.appendChild(cb);

      li.appendChild(timeEl);
      li.appendChild(body);
      li.appendChild(check);
      els.timeline.appendChild(li);
    }
  }

  function updateStatus(tasks, now) {
    let current = null;
    let next = null;
    for (const t of tasks) {
      if (now >= t.startDate && (t.instant ? now < new Date(t.startDate.getTime() + 60_000) : now < t.endDate)) {
        current = t;
      }
      if (!next && t.startDate > now) {
        next = t;
      }
    }

    if (current) {
      els.currentTask.textContent = current.title;
      els.currentRange.textContent = current.instant
        ? `à ${current.start}`
        : `${current.start} → ${current.end}`;
    } else {
      const firstTask = tasks[0];
      if (now < firstTask.startDate) {
        els.currentTask.textContent = "Service pas encore commencé";
        els.currentRange.textContent = `Début à ${firstTask.start}`;
      } else {
        els.currentTask.textContent = "Hors service";
        els.currentRange.textContent = "";
      }
    }

    if (next) {
      els.nextTask.textContent = next.title;
      els.nextCountdown.textContent = `${fmtDuration(next.startDate - now)} (à ${next.start})`;
    } else {
      els.nextTask.textContent = "Aucune";
      els.nextCountdown.textContent = "Service terminé";
    }

    const total = tasks.length;
    const doneCount = tasks.filter((t) => storageState.done[t.id]).length;
    els.progressText.textContent = `${doneCount} / ${total}`;
    els.progressFill.style.width = `${(doneCount / total) * 100}%`;
  }

  function updateClock(now) {
    els.clockTime.textContent = now.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    els.clockDate.textContent = now.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }

  // --- Alertes ---
  function startAlarmSound() {
    stopAlarmSound();
    try {
      if (!alarmAudioCtx) {
        alarmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (alarmAudioCtx.state === "suspended") {
        alarmAudioCtx.resume();
      }
    } catch {
      return;
    }

    const playBeep = () => {
      if (!alarmAudioCtx) return;
      const now = alarmAudioCtx.currentTime;
      const duration = 0.9;
      const gain = alarmAudioCtx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.35, now + 0.05);
      gain.gain.linearRampToValueAtTime(0, now + duration);
      gain.connect(alarmAudioCtx.destination);
      // Deux notes alternées pour faire "alarme"
      const osc1 = alarmAudioCtx.createOscillator();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.setValueAtTime(660, now + 0.3);
      osc1.frequency.setValueAtTime(880, now + 0.6);
      osc1.connect(gain);
      osc1.start(now);
      osc1.stop(now + duration);
    };

    playBeep();
    alarmInterval = setInterval(playBeep, 1200);
  }

  function stopAlarmSound() {
    if (alarmInterval) {
      clearInterval(alarmInterval);
      alarmInterval = null;
    }
  }

  function showAlarm(task) {
    els.alarmTitle.textContent = task.title;
    els.alarmMessage.textContent = `${task.instant ? `À ${task.start}` : `${task.start} → ${task.end}`} — ${task.desc}`;
    els.alarmOverlay.hidden = false;
    els.stopAlarm.hidden = false;
    startAlarmSound();
    try {
      if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
    } catch {}
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Veilleur de Nuit — " + task.title, {
          body: task.desc,
          tag: task.id,
          icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%8C%99%3C/text%3E%3C/svg%3E",
        });
      }
    } catch {}
    document.title = `⏰ ${task.title} — Veilleur de Nuit`;
  }

  function dismissAlarm() {
    els.alarmOverlay.hidden = true;
    els.stopAlarm.hidden = true;
    stopAlarmSound();
    document.title = "Veilleur de Nuit — Planning";
    alarmQueue.shift();
    if (alarmQueue.length > 0) {
      showAlarm(alarmQueue[0]);
    }
  }

  function checkAlerts(tasks, now) {
    for (const t of tasks) {
      if (!t.alert) continue;
      if (storageState.done[t.id]) continue;
      const snoozeUntil = storageState.snoozeUntil[t.id];
      const effectiveFireTime = snoozeUntil ? new Date(snoozeUntil) : t.startDate;
      if (storageState.fired[t.id] && !snoozeUntil) continue;

      // Fenêtre de déclenchement : maintenant dépasse l'heure prévue
      if (now >= effectiveFireTime && now - effectiveFireTime < 60 * 60 * 1000) {
        if (snoozeUntil) {
          delete storageState.snoozeUntil[t.id];
        }
        storageState.fired[t.id] = true;
        saveState();
        enqueueAlarm(t);
      }
    }
  }

  function enqueueAlarm(task) {
    if (alarmQueue.find((q) => q.id === task.id)) return;
    alarmQueue.push(task);
    if (alarmQueue.length === 1) {
      showAlarm(task);
    }
  }

  // --- Handlers ---
  function bindHandlers() {
    els.alarmAck.addEventListener("click", () => {
      const current = alarmQueue[0];
      if (current) {
        // on propose de cocher la tâche ? Non — l'utilisateur la cochera quand elle sera faite.
      }
      dismissAlarm();
    });

    els.alarmSnooze.addEventListener("click", () => {
      const current = alarmQueue[0];
      if (current) {
        const snooze = Date.now() + 5 * 60 * 1000;
        storageState.snoozeUntil[current.id] = snooze;
        storageState.fired[current.id] = false;
        saveState();
      }
      dismissAlarm();
    });

    els.testAlarm.addEventListener("click", () => {
      showAlarm({
        id: "__test__",
        start: fmtHM(new Date()),
        end: fmtHM(new Date()),
        title: "Test d'alarme",
        desc: "Ceci est un test. L'alarme fonctionne correctement.",
        instant: true,
      });
    });

    els.stopAlarm.addEventListener("click", () => {
      alarmQueue = [];
      dismissAlarm();
    });

    els.enableNotifs.addEventListener("click", async () => {
      if (!("Notification" in window)) {
        els.enableNotifs.textContent = "🚫 Notifications indisponibles";
        els.enableNotifs.disabled = true;
        return;
      }
      try {
        const perm = await Notification.requestPermission();
        if (perm === "granted") {
          els.enableNotifs.textContent = "✅ Notifications activées";
          els.enableNotifs.disabled = true;
        } else {
          els.enableNotifs.textContent = "🔕 Notifications refusées";
        }
      } catch {
        // ignore
      }
    });

    els.resetShift.addEventListener("click", () => {
      if (!confirm("Réinitialiser toutes les coches et alertes du service en cours ?")) return;
      storageState = defaultState();
      storageState.notes = els.notes.value; // on garde les notes saisies
      saveState();
      alarmQueue = [];
      dismissAlarm();
      update();
    });

    els.notes.addEventListener("input", () => {
      storageState.notes = els.notes.value;
      saveState();
    });

    // Quand la page redevient visible, on recalcule tout (utile après une longue inactivité)
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) update();
    });
  }

  // --- Boucle principale ---
  function update() {
    const now = new Date();
    const newShiftStart = getShiftStart(now);
    const newKey = shiftKey(newShiftStart);
    if (newKey !== currentShiftKey) {
      currentShiftStart = newShiftStart;
      currentShiftKey = newKey;
      storageState = loadState(currentShiftKey);
      els.notes.value = storageState.notes || "";
      alarmQueue = [];
      if (!els.alarmOverlay.hidden) dismissAlarm();
    }
    const tasks = buildSchedule();
    updateClock(now);
    renderTimeline(tasks, now);
    updateStatus(tasks, now);
    checkAlerts(tasks, now);
  }

  function init() {
    els.notes.value = storageState.notes || "";
    if ("Notification" in window && Notification.permission === "granted") {
      els.enableNotifs.textContent = "✅ Notifications activées";
      els.enableNotifs.disabled = true;
    }
    bindHandlers();
    update();
    setInterval(update, 1000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
