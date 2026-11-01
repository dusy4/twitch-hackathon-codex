(function () {
  // Section entrances: parts rise once as they enter. Content stays visible without JS or IntersectionObserver.
  var parts = document.querySelectorAll(".why__h, .why__grid p, .sec__h, .sec__lede, .step, .chat, .cmds, .ext, .flow, .card, .demo__frame, .stats, .status__col, .try__steps, .try .btn");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    Array.prototype.forEach.call(parts, function (el) {
      var sibs = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
      el.style.transitionDelay = Math.min(sibs, 4) * 70 + "ms";
      el.classList.add("rv");
      io.observe(el);
    });
  }
})();

(function () {
  // Planner example tabs: illustrative plan shapes for three real chat inputs.
  var plans = [
    [["navigate", "to <em>chair</em>", "nearest reachable label"], ["sit", "", "hold until replaced"], ["emote", "wave", ""]],
    [["navigate", "to <em>spot 3</em>", "number shown on stream now"], ["dance", "", ""]],
    [["emote", "wave", "Ukrainian phrase grammar, no model needed"]]
  ];
  var root = document.querySelector("[data-planner]");
  if (!root) return;
  var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
  var out = root.querySelector(".planner__out");
  function render(i) {
    tabs.forEach(function (t, j) {
      t.setAttribute("aria-selected", j === i ? "true" : "false");
      t.tabIndex = j === i ? 0 : -1;
    });
    out.innerHTML = plans[i].map(function (s) {
      return "<li><code>" + s[0] + "</code>" + (s[1] ? " " + s[1] : "") + (s[2] ? " <small>" + s[2] + "</small>" : "") + "</li>";
    }).join("");
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { render(i); });
    t.addEventListener("keydown", function (e) {
      var n = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!n) return;
      e.preventDefault();
      var k = (i + n + tabs.length) % tabs.length;
      render(k);
      tabs[k].focus();
    });
  });
  render(0);
})();
