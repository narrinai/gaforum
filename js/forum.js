/* GA Forum client: progressive enhancement only. Content is server-rendered. */
(function () {
  "use strict";

  var root = document.querySelector(".gaf[data-auth]");
  if (!root) return;

  var MESSAGES = {
    login_unavailable: "Login is temporarily unavailable. Please try again later.",
    storage_unavailable: "Posting is unavailable right now. Please try again later.",
    mail_failed: "We could not send the email. Please try again in a minute.",
    invalid_email: "Please enter a valid email address.",
    invalid_code: "That code is not right. Please check it and try again.",
    code_expired: "That code has expired. Please ask for a new one.",
    too_many_attempts: "Too many wrong tries. Please ask for a new code.",
    rate_limited: "Slow down a little. Please try again in a moment.",
    name_length: "Your name needs 3 to 24 characters.",
    name_chars: "Use letters, digits, spaces, _ - or dots only.",
    name_reserved: "That name is reserved. Please pick another one.",
    name_taken: "That name is taken. Please pick another one.",
    name_already_set: "You already have a display name.",
    name_required: "Pick a display name first.",
    login_required: "Please log in first.",
    title_length: "Titles need 8 to 120 characters.",
    body_length: "Posts need 2 to 10,000 characters.",
    reason_length: "Keep the reason under 300 characters.",
    thread_locked: "This thread is locked.",
    edit_window_closed: "Posts can only be edited for 15 minutes.",
    already_reported: "You already reported this post. Thanks!",
    own_post: "You can't report your own post.",
    forbidden_origin: "Please reload the page and try again.",
    body_too_large: "That is too long.",
    spam_detected: "Something went wrong. Please reload the page.",
    not_found: "This post no longer exists.",
    forbidden: "You can't do that.",
    unknown_board: "Please pick a board."
  };

  function msgFor(data, status) {
    if (data && data.error && MESSAGES[data.error]) {
      var m = MESSAGES[data.error];
      if (data.error === "rate_limited" && data.retryAfter) m = "Slow down a little. Try again in " + fmtWait(data.retryAfter) + ".";
      if (data.error === "invalid_code" && data.remaining) m += " " + data.remaining + (data.remaining === 1 ? " try" : " tries") + " left.";
      return m;
    }
    if (status === 0) return "You seem to be offline. Please try again.";
    return "Something went wrong. Please try again.";
  }

  function fmtWait(s) {
    if (s < 60) return s + " seconds";
    var m = Math.ceil(s / 60);
    return m + (m === 1 ? " minute" : " minutes");
  }

  function api(method, path, body) {
    var opts = { method: method, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch("/api/forum/" + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    }, function () {
      return { ok: false, status: 0, data: {} };
    });
  }

  function setMsg(el, text, isError) {
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("gaf-msg--error", !!isError);
  }

  function busy(form, on) {
    var btns = form.querySelectorAll("button[type=submit]");
    for (var i = 0; i < btns.length; i++) btns[i].disabled = on;
    form.setAttribute("aria-busy", on ? "true" : "false");
  }

  // ---------- login dialog ----------
  var dialog = document.getElementById("gaf-login");
  var lastFocus = null;
  var currentEmail = "";

  function showStep(step) {
    if (!dialog) return;
    var forms = dialog.querySelectorAll(".gaf-step");
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      f.hidden = f.getAttribute("data-step") !== step;
      setMsg(f.querySelector(".gaf-msg"), "");
    }
    var active = dialog.querySelector('.gaf-step[data-step="' + step + '"]');
    var input = active && active.querySelector("input:not([name=hp])");
    if (input) setTimeout(function () { input.focus(); }, 30);
  }

  function openDialog(step) {
    if (!dialog) return;
    if (root.getAttribute("data-available") === "0") {
      alert(MESSAGES.login_unavailable);
      return;
    }
    lastFocus = document.activeElement;
    showStep(step || "email");
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
      dialog.classList.add("gaf-dialog--fallback");
    }
  }

  function closeDialog() {
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else { dialog.removeAttribute("open"); dialog.classList.remove("gaf-dialog--fallback"); }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  if (dialog) {
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog) closeDialog(); // backdrop click
    });
    dialog.addEventListener("close", function () {
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    });
    dialog.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !dialog.showModal) closeDialog();
    });
    var closeBtn = dialog.querySelector("[data-gaf-close]");
    if (closeBtn) closeBtn.addEventListener("click", closeDialog);
    var back = dialog.querySelector("[data-gaf-back]");
    if (back) back.addEventListener("click", function () { showStep("email"); });

    var emailForm = dialog.querySelector('[data-step="email"]');
    emailForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = emailForm.querySelector(".gaf-msg");
      var email = emailForm.elements.email.value.trim();
      if (!email || email.indexOf("@") < 1) { setMsg(msg, MESSAGES.invalid_email, true); return; }
      busy(emailForm, true);
      setMsg(msg, "Sending your code...");
      api("POST", "auth/start", { email: email, hp: emailForm.elements.hp.value }).then(function (r) {
        busy(emailForm, false);
        if (!r.ok) { setMsg(msg, msgFor(r.data, r.status), true); return; }
        currentEmail = email;
        var span = dialog.querySelector("[data-gaf-email]");
        if (span) span.textContent = email;
        showStep("code");
      });
    });

    var codeForm = dialog.querySelector('[data-step="code"]');
    codeForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = codeForm.querySelector(".gaf-msg");
      var code = codeForm.elements.code.value.replace(/\D/g, "");
      if (code.length !== 6) { setMsg(msg, "Enter the 6-digit code from the email.", true); return; }
      busy(codeForm, true);
      setMsg(msg, "Checking...");
      api("POST", "auth/verify", { email: currentEmail, code: code }).then(function (r) {
        busy(codeForm, false);
        if (!r.ok) { setMsg(msg, msgFor(r.data, r.status), true); return; }
        if (r.data.needsName) showStep("name");
        else afterLogin();
      });
    });

    var nameForm = dialog.querySelector('[data-step="name"]');
    nameForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = nameForm.querySelector(".gaf-msg");
      var name = nameForm.elements.name.value.trim();
      if (name.length < 3 || name.length > 24) { setMsg(msg, MESSAGES.name_length, true); return; }
      busy(nameForm, true);
      api("POST", "auth/name", { name: name }).then(function (r) {
        busy(nameForm, false);
        if (!r.ok) { setMsg(msg, msgFor(r.data, r.status), true); return; }
        afterLogin();
      });
    });
  }

  function afterLogin() {
    if (location.pathname === "/forum/login") {
      var next = new URLSearchParams(location.search).get("next");
      location.href = next && /^\/forum(\/|$)/.test(next) ? next : "/forum";
    } else {
      location.reload();
    }
  }

  // Login links: open the dialog instead of navigating.
  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-gaf-login]") : null;
    if (t) {
      e.preventDefault();
      openDialog(root.getAttribute("data-auth") === "in" ? "name" : "email");
      return;
    }
    t = e.target.closest ? e.target.closest("[data-gaf-name]") : null;
    if (t) { e.preventDefault(); openDialog("name"); }
  });

  var auto = document.querySelector("[data-gaf-autoopen]");
  if (auto) openDialog(root.getAttribute("data-auth") === "in" ? "name" : "email");

  // Rewrite login links to come back to this page after a no-dialog fallback.
  var loginLinks = document.querySelectorAll('a[data-gaf-login][href="/forum/login"]');
  for (var li = 0; li < loginLinks.length; li++) {
    if (location.pathname !== "/forum/login") loginLinks[li].href = "/forum/login?next=" + encodeURIComponent(location.pathname + location.search);
  }

  // ---------- new thread toggle ----------
  var toggles = document.querySelectorAll("[data-gaf-toggle]");
  for (var ti = 0; ti < toggles.length; ti++) {
    (function (btn) {
      var target = document.getElementById(btn.getAttribute("data-gaf-toggle"));
      if (!target) return;
      target.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-controls", target.id);
      btn.setAttribute("role", "button");
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        target.hidden = !target.hidden;
        btn.setAttribute("aria-expanded", target.hidden ? "false" : "true");
        if (!target.hidden) {
          var first = target.querySelector("input:not([name=hp]), textarea");
          if (first) first.focus();
        }
      });
    })(toggles[ti]);
  }

  // ---------- thread and reply forms ----------
  var forms = document.querySelectorAll("form[data-gaf-form]");
  for (var fi = 0; fi < forms.length; fi++) {
    forms[fi].addEventListener("submit", function (e) {
      e.preventDefault();
      var form = e.currentTarget;
      var kind = form.getAttribute("data-gaf-form");
      var msg = form.querySelector(".gaf-msg");
      var body = form.elements.body.value.trim();
      var hp = form.elements.hp ? form.elements.hp.value : "";
      var req;
      if (kind === "thread") {
        var title = form.elements.title.value.trim();
        if (title.length < 8 || title.length > 120) { setMsg(msg, MESSAGES.title_length, true); form.elements.title.focus(); return; }
        if (body.length < 2 || body.length > 10000) { setMsg(msg, MESSAGES.body_length, true); form.elements.body.focus(); return; }
        req = api("POST", "threads", { board: form.getAttribute("data-board"), title: title, body: body, hp: hp });
      } else {
        if (body.length < 2 || body.length > 10000) { setMsg(msg, MESSAGES.body_length, true); form.elements.body.focus(); return; }
        req = api("POST", "threads/" + encodeURIComponent(form.getAttribute("data-thread")) + "/replies", { body: body, hp: hp });
      }
      busy(form, true);
      setMsg(msg, "Posting...");
      req.then(function (r) {
        busy(form, false);
        if (!r.ok) { setMsg(msg, msgFor(r.data, r.status), true); return; }
        if (r.data.status === "held") setMsg(msg, "Thanks! Your post is waiting for review.");
        var dest = r.data.url;
        if (dest) {
          var samePage = dest.split("#")[0] === location.pathname + location.search;
          location.href = dest;
          if (samePage) location.reload();
        } else location.reload();
      });
    });
  }

  // ---------- edit and report ----------
  function postEl(id) {
    return document.querySelector('[data-post-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"].gaf-post');
  }

  function refreshEditButtons() {
    var btns = document.querySelectorAll("[data-gaf-edit]");
    var now = Date.now();
    for (var i = 0; i < btns.length; i++) {
      var until = Date.parse(btns[i].getAttribute("data-edit-until"));
      if (!(until > now)) btns[i].remove();
    }
  }
  refreshEditButtons();
  setInterval(refreshEditButtons, 30000);

  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    var edit = e.target.closest("[data-gaf-edit]");
    if (edit) { e.preventDefault(); startEdit(edit); return; }
    var rep = e.target.closest("[data-gaf-report]");
    if (rep) { e.preventDefault(); startReport(rep); return; }
    var adm = e.target.closest("[data-gaf-admin]");
    if (adm) { e.preventDefault(); adminAct(adm); return; }
    var out = e.target.closest("[data-gaf-logout]");
    if (out) {
      e.preventDefault();
      out.disabled = true;
      api("POST", "auth/logout", {}).then(function () { location.href = "/forum"; });
    }
  });

  function inlineForm(post, html) {
    var existing = post.querySelector(".gaf-inline");
    if (existing) existing.remove();
    var form = document.createElement("form");
    form.className = "gaf-inline gaf-form";
    form.noValidate = true;
    form.innerHTML = html;
    post.appendChild(form);
    var cancel = form.querySelector("[data-cancel]");
    if (cancel) cancel.addEventListener("click", function () { form.remove(); });
    return form;
  }

  function startEdit(btn) {
    var id = btn.getAttribute("data-gaf-edit");
    var post = postEl(id);
    if (!post) return;
    var src = post.querySelector(".gaf-src");
    var form = inlineForm(post,
      '<label class="gaf-label" for="edit-' + id.replace(/\W/g, "-") + '">Edit your post</label>' +
      '<textarea class="gaf-input gaf-textarea" id="edit-' + id.replace(/\W/g, "-") + '" name="body" rows="6" maxlength="10000"></textarea>' +
      '<div class="gaf-actions"><button class="btn" type="submit">Save</button><button class="btn btn--ghost" type="button" data-cancel>Cancel</button></div>' +
      '<p class="gaf-msg" role="status" aria-live="polite"></p>');
    form.elements.body.value = src ? src.value : "";
    form.elements.body.focus();
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = form.querySelector(".gaf-msg");
      var body = form.elements.body.value.trim();
      if (body.length < 2 || body.length > 10000) { setMsg(msg, MESSAGES.body_length, true); return; }
      busy(form, true);
      api("PATCH", "posts/" + encodeURIComponent(id), { body: body }).then(function (r) {
        busy(form, false);
        if (!r.ok) { setMsg(msg, msgFor(r.data, r.status), true); return; }
        location.reload();
      });
    });
  }

  function startReport(btn) {
    var id = btn.getAttribute("data-gaf-report");
    var post = postEl(id);
    if (!post) return;
    var fid = "report-" + id.replace(/\W/g, "-");
    var form = inlineForm(post,
      '<label class="gaf-label" for="' + fid + '">Why are you reporting this post? (optional)</label>' +
      '<textarea class="gaf-input" id="' + fid + '" name="reason" rows="3" maxlength="300"></textarea>' +
      '<div class="gaf-actions"><button class="btn" type="submit">Send report</button><button class="btn btn--ghost" type="button" data-cancel>Cancel</button></div>' +
      '<p class="gaf-msg" role="status" aria-live="polite"></p>');
    form.elements.reason.focus();
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = form.querySelector(".gaf-msg");
      busy(form, true);
      api("POST", "posts/" + encodeURIComponent(id) + "/report", { reason: form.elements.reason.value.trim() }).then(function (r) {
        busy(form, false);
        if (!r.ok) { setMsg(msg, msgFor(r.data, r.status), !(r.data && r.data.error === "already_reported")); return; }
        form.innerHTML = '<p class="gaf-msg" role="status">Thanks for the report. A moderator will take a look.</p>';
        btn.remove();
      });
    });
  }

  function adminAct(btn) {
    var action = btn.getAttribute("data-gaf-admin");
    var payload;
    if (action === "lock") {
      payload = { threadId: btn.getAttribute("data-thread-id"), locked: btn.getAttribute("data-locked") !== "1" };
    } else {
      payload = { postId: btn.getAttribute("data-post-id") };
      if (action === "delete" && !confirm("Delete this post for good?")) return;
    }
    btn.disabled = true;
    api("POST", "admin/" + action, payload).then(function (r) {
      btn.disabled = false;
      if (!r.ok) { alert(msgFor(r.data, r.status)); return; }
      location.reload();
    });
  }
})();
