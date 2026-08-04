(function () {
  "use strict";

  var $ = function (selector, root) {
    return (root || document).querySelector(selector);
  };
  var $$ = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  };

  var judgerTabs = $$(".judger-tab");
  var judgerPanels = $$(".judger-panel");
  var selectJudger = function (button) {
    var id = button.getAttribute("data-judger");
    judgerTabs.forEach(function (tab) {
      var active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.setAttribute("tabindex", active ? "0" : "-1");
    });
    judgerPanels.forEach(function (panel) {
      var active = panel.getAttribute("data-panel") === id;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });
  };
  judgerTabs.forEach(function (button, index) {
    button.addEventListener("click", function () { selectJudger(button); });
    button.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      var step = event.key === "ArrowRight" ? 1 : -1;
      var next = judgerTabs[(index + step + judgerTabs.length) % judgerTabs.length];
      selectJudger(next);
      next.focus();
    });
  });

  var expertTabs = $$(".expert-tab");
  var expertPanels = $$(".expert-panel");
  var selectExpert = function (button) {
    var id = button.getAttribute("data-expert");
    expertTabs.forEach(function (tab) {
      var active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.setAttribute("tabindex", active ? "0" : "-1");
    });
    expertPanels.forEach(function (panel) {
      var active = panel.getAttribute("data-expert-panel") === id;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });
  };
  expertTabs.forEach(function (button, index) {
    var id = button.getAttribute("data-expert");
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "expert-" + id);
    expertPanels.forEach(function (panel) {
      if (panel.getAttribute("data-expert-panel") === id) {
        panel.id = "expert-" + id;
        panel.setAttribute("role", "tabpanel");
      }
    });
    button.addEventListener("click", function () {
      selectExpert(button);
    });
    button.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      var step = event.key === "ArrowRight" ? 1 : -1;
      var next = expertTabs[(index + step + expertTabs.length) % expertTabs.length];
      selectExpert(next);
      next.focus();
    });
  });

  $$(".tabs").forEach(function (tabs) {
    var buttons = $$(".tab", tabs);
    var panels = $$(".tabpanel", tabs);
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        buttons.forEach(function (item) {
          item.setAttribute("aria-selected", "false");
        });
        panels.forEach(function (panel) {
          panel.classList.remove("active");
          panel.hidden = true;
        });
        button.setAttribute("aria-selected", "true");
        var target = $("#" + button.getAttribute("aria-controls"), tabs);
        target.classList.add("active");
        target.hidden = false;
      });
    });
  });

  $$(".copy").forEach(function (button) {
    button.addEventListener("click", function () {
      var code = button.parentElement.querySelector("code");
      var text = code ? code.textContent : "";
      var done = function () {
        button.textContent = "已复制";
        button.classList.add("copied");
        window.setTimeout(function () {
          button.textContent = "复制";
          button.classList.remove("copied");
        }, 1400);
      };
      var fallbackCopy = function () {
        var area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
        done();
      };
      fallbackCopy();
    });
  });

  var menu = $(".menu-toggle");
  var sidebar = $(".sidebar");
  if (menu && sidebar) {
    menu.addEventListener("click", function () {
      var isOpen = sidebar.classList.toggle("open");
      menu.setAttribute("aria-expanded", String(isOpen));
      menu.textContent = isOpen ? "×" : "目录";
    });
    $$(".toc a").forEach(function (link) {
      link.addEventListener("click", function () {
        sidebar.classList.remove("open");
        menu.setAttribute("aria-expanded", "false");
        menu.textContent = "目录";
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !sidebar.classList.contains("open")) return;
      sidebar.classList.remove("open");
      menu.setAttribute("aria-expanded", "false");
      menu.textContent = "目录";
      menu.focus();
    });
  }

  var lightbox = $("#image-lightbox");
  if (lightbox) {
    var lightboxImage = $(".lightbox-image", lightbox);
    var lightboxCaption = $(".lightbox-caption", lightbox);
    var lightboxClose = $(".lightbox-close", lightbox);
    var lastZoomTrigger = null;
    var closeLightbox = function () {
      lightbox.hidden = true;
      document.body.classList.remove("lightbox-open");
      lightboxImage.src = "";
      if (lastZoomTrigger) lastZoomTrigger.focus();
    };
    $$(".image-zoom").forEach(function (button) {
      button.addEventListener("click", function () {
        var sourceImage = $("img", button);
        lastZoomTrigger = button;
        lightboxImage.src = button.getAttribute("data-full") || sourceImage.src;
        lightboxImage.alt = sourceImage.alt;
        lightboxCaption.textContent = sourceImage.alt;
        lightbox.hidden = false;
        document.body.classList.add("lightbox-open");
        lightboxClose.focus();
      });
    });
    lightboxClose.addEventListener("click", closeLightbox);
    lightbox.addEventListener("click", function (event) {
      if (event.target === lightbox) closeLightbox();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !lightbox.hidden) closeLightbox();
    });
  }

  var links = $$(".toc a");
  var sections = links.map(function (link) {
    return $(link.getAttribute("href"));
  }).filter(Boolean);
  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (link) {
          link.classList.toggle("active", link.getAttribute("href") === "#" + entry.target.id);
        });
      });
    }, { rootMargin: "-18% 0px -70% 0px" });
    sections.forEach(function (section) { observer.observe(section); });
  }

  var ring = $(".score-ring");
  if (ring && "IntersectionObserver" in window) {
    var ringObserver = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) {
        ring.style.setProperty("--progress", "100%");
        ringObserver.disconnect();
      }
    }, { threshold: 0.45 });
    ring.style.setProperty("--progress", "0%");
    ringObserver.observe(ring);
  }
}());
