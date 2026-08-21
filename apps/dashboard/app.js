(function dashboardDemo() {
  "use strict";
  const fixture = [
    { ts: 0, type: "environment.screen", layer: "Environment" },
    { ts: 80, type: "canvas.write", layer: "Canvas" },
    { ts: 145, type: "canvas.read", layer: "Canvas" },
    { ts: 210, type: "webgl.parameter", layer: "WebGL" },
    { ts: 310, type: "crypto.digest", layer: "Digest" },
    { ts: 470, type: "storage.write", layer: "Storage" },
    { ts: 620, type: "network.request", layer: "3rd-party" }
  ];
  const positions = [[80,190],[210,90],[210,280],[370,135],[500,190],[650,95],[650,285]];
  const colors = ["#5af0bf","#75bfff","#8c7dff","#f2ca72","#ff9a7e","#d897ff","#ff6f88"];
  let timer;
  const $ = (id) => document.getElementById(id);

  function svgElement(name, attrs) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attrs || {})) element.setAttribute(key, value);
    return element;
  }
  function renderGraph(count) {
    const svg = $("graph-canvas"); svg.replaceChildren();
    for (let i = 1; i < count; i += 1) svg.append(svgElement("line", { x1:positions[i-1][0],y1:positions[i-1][1],x2:positions[i][0],y2:positions[i][1],class:"edge" }));
    for (let i = 0; i < count; i += 1) {
      const group=svgElement("g",{class:"node"}); const circle=svgElement("circle",{cx:positions[i][0],cy:positions[i][1],r:39}); circle.style.stroke=colors[i];
      const label=svgElement("text",{x:positions[i][0],y:positions[i][1]+4,"text-anchor":"middle"}); label.textContent=fixture[i].layer;
      group.append(circle,label); svg.append(group);
    }
  }
  function renderTimeline(count) {
    $("timeline").replaceChildren(...fixture.slice(0,count).map((item,index)=>{const li=document.createElement("li");const n=document.createElement("b");n.textContent=`0${index+1} · +${item.ts}ms`;const text=document.createElement("span");text.textContent=item.type;li.append(n,text);return li;}));
  }
  function run() {
    clearInterval(timer); let count=0; $("risk").textContent="0"; $("confidence").textContent="0"; renderGraph(0); renderTimeline(0);
    timer=setInterval(()=>{count+=1;const risk=Math.min(88,Math.round(count*12.6));const confidence=Math.min(91,Math.round(Math.max(0,count-1)*15.2));$("risk").textContent=String(risk);$("confidence").textContent=String(confidence);$("event-count").textContent=String(count);$("edge-count").textContent=String(Math.max(0,count-1));renderGraph(count);renderTimeline(count);if(count===fixture.length){clearInterval(timer);$("policy").textContent="PROTECT";$("before").textContent="88";$("after").textContent="30";$("recommendation").textContent="Canvas 결정적 변조, 알려진 추적 파라미터 정리, 제3자 토큰 가드를 조합하면 호환성 비용 6으로 목표 위험도에 도달할 수 있습니다.";$("interventions").innerHTML="<li>canvas-perturb</li><li>tracking-parameter-cleaner</li><li>third-party-token-guard</li>";}},260);
  }
  $("legend").replaceChildren(...fixture.map((item,index)=>{const span=document.createElement("span");span.textContent=item.layer;span.style.borderColor=colors[index];return span;}));
  $("replay").addEventListener("click",run); run();
})();
