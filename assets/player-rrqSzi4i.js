import{d as dt,x as ut,t as pt,a as et,p as at,j as st,D as ht,S as gt,h as I,u as R,i as N,A as nt,c as ft,e as yt,v as mt,w as bt,g as v,f as wt,n as $t,r as U,b as z}from"./attribution-CQShap8b.js";function kt(){dt()}const T=56,it=30,ot=16e3,St=[[60,"60"],[250,"250"],[1e3,"1k"],[4e3,"4k"],[12e3,"12k"]];function vt(t,e){const a=[],n=Math.log(it),i=Math.log(Math.min(ot,t/2));for(let s=0;s<=T;s+=1){const l=Math.exp(n+(i-n)*s/T);a.push(Math.min(e-1,Math.round(l/(t/2)*e)))}return a}function Mt(t){const e=t.getContext("2d");let a=null,n=null,i=null,s=new Float32Array(T);function l(){const c=window.devicePixelRatio||1,g=t.getBoundingClientRect();t.width=Math.max(1,Math.round(g.width*c)),t.height=Math.max(1,Math.round(g.height*c))}function d(){e.clearRect(0,0,t.width,t.height),o()}function o(){const{width:c,height:g}=t,f=window.devicePixelRatio||1;e.font=`${10*f}px system-ui, sans-serif`,e.fillStyle="rgba(214, 202, 178, .45)",e.textAlign="center";const $=Math.log(it),S=Math.log(ot);for(const[k,h]of St){const b=(Math.log(k)-$)/(S-$)*c;e.fillText(h,b,g-4*f)}}function p(){a=requestAnimationFrame(p);const c=ut();if(!c){d();return}const g=c.frequencyBinCount;(!n||n.length!==g)&&(n=new Uint8Array(g),i=vt(c.context.sampleRate,g)),c.getByteFrequencyData(n);const{width:f,height:$}=t,S=window.devicePixelRatio||1,k=16*S,h=$-k,b=f/T;e.clearRect(0,0,f,$);for(let y=0;y<T;y+=1){let X=0,j=0;for(let B=i[y];B<=i[y+1];B+=1)X+=n[B],j+=1;const H=j>0?X/j/255:0;s[y]=Math.max(H,s[y]*.96);const Z=H*h,Q=y*b,lt=18+H*26;e.fillStyle=`hsl(${lt} 68% ${28+H*30}%)`,e.fillRect(Q+1,h-Z,Math.max(1,b-2),Z);const ct=h-s[y]*h;e.fillStyle="rgba(224, 196, 148, .8)",e.fillRect(Q+1,ct,Math.max(1,b-2),1.5*S)}o()}function r(){l(),a===null&&p()}function w(){a!==null&&(cancelAnimationFrame(a),a=null),s=new Float32Array(T),d()}return window.addEventListener("resize",l),l(),d(),{start:r,stop:w}}const xt=30,Tt=22,q=58;function At(t,e,a=.5){return e==="wave"?`hsla(${16+a*30}, 70%, ${34+a*28}%, ${t})`:e==="center"?`rgba(232, 221, 200, ${t})`:e==="tick"?`rgba(201, 111, 47, ${t})`:`rgba(222, 155, 90, ${t})`}async function qt(t,e=fetch){try{const a=await e(et(`timeline-previews/${t}.json`));return a.ok?await a.json():null}catch{return null}}function Pt(t,{onSeek:e}={}){t.classList.add("pp-lanes"),t.innerHTML=`
    <canvas class="pp-lanes-canvas"></canvas>
    <div class="pp-lanes-playhead" hidden></div>
  `;const a=t.querySelector("canvas"),n=t.querySelector(".pp-lanes-playhead"),i=a.getContext("2d");let s=null,l=[];function d(r){return r.kind==="notes"?xt:Tt}function o(){if(!s){t.hidden=!0;return}t.hidden=!1;const r=window.devicePixelRatio||1,w=t.clientWidth,c=s.lanes.reduce((h,b)=>h+d(b),0);a.style.height=`${c}px`,a.width=Math.max(1,Math.round(w*r)),a.height=Math.max(1,Math.round(c*r));const g=a.width,f=q*r,$=g-f,S=s.bars*s.stepsPerBar;i.clearRect(0,0,g,a.height);let k=0;s.lanes.forEach((h,b)=>{const y=d(h)*r;i.fillStyle=b%2===0?"rgba(255,255,255,.025)":"rgba(0,0,0,.12)",i.fillRect(0,k,g,y),i.fillStyle="rgba(214,202,178,.55)",i.font=`${9.5*r}px system-ui, sans-serif`,i.textBaseline="middle",i.fillText(h.label.slice(0,9),6*r,k+y/2),pt(i,h,{x:f,y:k,width:$,height:y,ratio:r,totalSteps:S,color:At}),k+=y}),i.fillStyle="rgba(232, 221, 200, .28)";for(const h of l){const b=f+h/s.durationSeconds*$;i.fillRect(b,0,r,a.height)}i.fillStyle="rgba(232,221,200,.12)",i.fillRect(f,0,r,a.height)}function p(r,w){if(!s||!w){n.hidden=!0;return}const g=t.clientWidth-q,f=q+Math.min(1,r/s.durationSeconds)*g;n.hidden=!1,n.style.left=`${f}px`}return t.addEventListener("click",r=>{if(!s||!e)return;const w=t.getBoundingClientRect(),c=(r.clientX-w.left-q)/(w.width-q);c>=0&&c<=1&&e(Math.round(c*s.durationSeconds))}),window.addEventListener("resize",o),{load(r,w=[]){s=r,l=w,n.hidden=!0,o()},setPosition:p,clear(){s=null,l=[],t.hidden=!0}}}kt();const O=[{id:"init",label:"Init",statuses:["sketch"]},{id:"in-progress",label:"In Progress",statuses:["arranging"]},{id:"pre-release",label:"Pre-Release",statuses:["mix-ready","release-ready"]},{id:"released",label:"Released",statuses:["released"]}];function G(t){return O.find(e=>e.statuses.includes(t.status))??O[0]}function E(t){var e;return((e=t.timeline)==null?void 0:e.durationSeconds)>0?t.timeline.durationSeconds:t.durationTargetMinutes>0?Math.round(t.durationTargetMinutes*60):0}function W(t){const e=/^(\d+):(\d{2})$/.exec(t??"");return e?Number(e[1])*60+Number(e[2]):0}const C=at.filter(t=>st(t)),m=document.querySelector("#player-root"),Ct="Strudel listening room",Et=nt==="demo"?"Complete tracks built from live-coded patterns. This demo plays the example track in your browser.":"Complete tracks built from live-coded patterns, served from your own machine.";m.innerHTML=`
  <main class="pp-shell" id="player-main" tabindex="-1">
    <header class="pp-top">
      <div class="pp-identity">
        ${I(R.profileImage)?`<img class="pp-profile-image" src="${u(R.profileImage.src)}"
                alt="${u(R.profileImage.alt)}"
                style="object-position: ${N(R.profileImage)}" />`:""}
        <div>
          <p class="pp-eyebrow">Track Forge · Listening player</p>
          <h1>${u(Ct)}</h1>
          <p class="pp-motto">${u(Et)}</p>
        </div>
      </div>
      <a class="pp-studio-link" href="${et("index.html")}">Open Studio</a>
    </header>

    ${nt==="demo"?`<p class="pp-mode-notice" data-mode-notice>
            <strong>${ht.player}</strong>
            To listen to your own tracks on your network, <a href="${gt}#put-the-player-on-your-local-network">run Track Forge locally</a>.
          </p>`:""}

    <section class="pp-intro" aria-labelledby="player-intro-title">
      <p class="pp-eyebrow">Code becomes a complete arrangement</p>
      <h2 id="player-intro-title">Choose a track, press play and follow how its layers evolve.</h2>
      <p>The focused player uses the same plain Strudel files as the Studio—no account or cloud service required.</p>
    </section>

    <section class="pp-now" data-now hidden aria-labelledby="now-playing-title">
      <div data-now-artwork></div>
      <div class="pp-now-head">
        <div class="pp-now-title">
          <p class="pp-eyebrow">Now selected</p>
          <h2 id="now-playing-title" data-now-title></h2>
          <span class="pp-chip" data-now-status></span>
        </div>
        <button type="button" class="pp-meta-button" data-action="show-meta">Info</button>
      </div>

      <canvas class="pp-spectrum" data-spectrum aria-hidden="true"></canvas>

      <div class="pp-progress">
        <div class="pp-progress-fill" data-progress-fill aria-hidden="true"></div>
        <input class="pp-progress-input" type="range" min="0" max="0" step="1" value="0"
          data-progress aria-label="Track position" aria-valuetext="0:00 of 0:00" />
      </div>

      <div class="pp-phases" data-now-phases></div>

      <div class="pp-lanes-wrap" data-lanes aria-hidden="true" hidden></div>

      <div class="pp-controls">
        <button type="button" data-action="reset" aria-label="Back to start" title="Back to start">⏮</button>
        <button type="button" data-action="back30" aria-label="Back 30 seconds">−30</button>
        <button type="button" class="pp-play" data-action="toggle">
          <span data-play-icon aria-hidden="true"></span>
        </button>
        <button type="button" data-action="fwd30" aria-label="Forward 30 seconds">+30</button>
        <output class="pp-clock" data-clock aria-label="Playback time">0:00 / 0:00</output>
      </div>
      <p class="pp-status-line" data-status-line role="status" aria-live="polite"></p>
    </section>

    <section class="pp-library" data-library></section>
    ${ft("pp-attribution")}
  </main>

  <dialog class="pp-meta" data-meta aria-labelledby="player-meta-title"></dialog>
  <div class="pp-engine" aria-hidden="true" data-engine></div>
`;function Lt(){const t=document.createElement("strudel-editor");return t.sync=!1,t.solo=!1,t.setAttribute("code","silence"),m.querySelector("[data-engine]").append(t),$t(t)}const M=yt({engines:{full:Lt(),channels:[]},onChange:x,hooks:{onSilence:bt,onWake:mt}}),F=Mt(m.querySelector("[data-spectrum]")),D=Pt(m.querySelector("[data-lanes]"),{onSeek:t=>A(t)});var tt;let V=((tt=C[0])==null?void 0:tt.id)??null,P=null,_=null;async function rt(t){if(!t||_===t.id)return;_=t.id;const e=await qt(t.id);if(_!==t.id)return;if(!e){D.clear();return}const a=(Array.isArray(t.arrangement)?t.arrangement:[]).map(n=>W(n.at)).filter(n=>n>0);D.load(e,a)}function L(){return C.find(t=>t.id===V)??null}function Y(t){var a;const e=M.getState();return e.status==="stopped"&&((a=e.activeTrack)==null?void 0:a.id)===t?e.elapsedSeconds:0}async function A(t=0){const e=L(),a=st(e);if(!e||!a)return;const n=await M.playFull({id:e.id,title:e.title,code:a.code,bpm:e.bpm,durationTargetMinutes:e.durationTargetMinutes,durationSeconds:E(e)||void 0},{offsetSeconds:t});!n.ok&&n.message&&(m.querySelector("[data-status-line]").textContent=n.message)}function u(t){return String(t??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function Ht(){const t=M.getState(),e=m.querySelector("[data-library]"),a=O.map(n=>{const i=C.filter(s=>G(s).id===n.id);return i.length===0?"":`
      <section class="pp-phase-group">
        <h3 class="pp-phase-title">${n.label}
          <span class="pp-phase-count">${i.length}</span>
        </h3>
        <ul class="pp-track-list">
          ${i.map(s=>{var p;const l=s.id===V,d=l&&((p=t.activeTrack)==null?void 0:p.id)===s.id&&t.status==="playing",o=U(s);return`
                <li class="pp-track-card ${l?"is-active":""}">
                  <button type="button" class="pp-track ${l?"is-active":""}"
                    data-action="pick" data-id="${s.id}"
                    ${l?'aria-current="true"':""}>
                    <span class="pp-sr-only">${d?"Stop":"Play"} </span>
                    <span class="pp-track-play" aria-hidden="true">${d?"■":"▶"}</span>
                    ${I(o)?`<img class="pp-track-artwork" src="${u(o.src)}"
                            alt="" style="object-position: ${N(o)}" />`:""}
                    <span class="pp-track-main">
                      <strong>${u(s.title)}</strong>
                      <small>${s.bpm} BPM · ${v(E(s))}
                        · ${z[s.status]??s.status}</small>
                    </span>
                  </button>
                  <button type="button" class="pp-track-info" data-action="meta" data-id="${s.id}"
                    aria-label="About ${u(s.title)}"><span aria-hidden="true">i</span></button>
                </li>
              `}).join("")}
        </ul>
      </section>
    `}).join("");e.innerHTML=`
    <header class="pp-library-head">
      <p class="pp-eyebrow">Track library</p>
      <h2>Choose a track to listen</h2>
      <p>Selecting a track starts it immediately. Use the separate Info button for its story and sound palette.</p>
    </header>
    ${a||'<p class="pp-empty">No playable tracks were found.</p>'}
  `}function J(){var $;const t=M.getState(),e=L(),a=m.querySelector("[data-now]");if(!e){a.hidden=!0,F.stop();return}a.hidden=!1;const n=U(e);a.querySelector("[data-now-artwork]").innerHTML=I(n)?`<img class="pp-now-artwork" src="${u(n.src)}"
        alt="${u(n.alt)}"
        style="object-position: ${N(n)}" />`:"";const i=E(e),s=(($=t.activeTrack)==null?void 0:$.id)===e.id,l=s&&t.status==="playing",d=s&&t.status==="loading",o=s?t.elapsedSeconds:0;a.querySelector("[data-now-title]").textContent=e.title;const p=a.querySelector("[data-now-status]");p.textContent=`${G(e).label} · ${z[e.status]??e.status}`;const r=a.querySelector('[data-action="toggle"]');r.querySelector("[data-play-icon]").textContent=d?"…":l?"■":"▶",r.disabled=d,r.setAttribute("aria-label",d?`Loading ${e.title}`:l?`Stop ${e.title}`:`Play ${e.title}`),a.querySelector("[data-clock]").textContent=`${v(Math.min(o,i))} / ${v(i)}`;const w=a.querySelector("[data-progress-fill]");w.style.width=i>0?`${Math.min(100,o/i*100)}%`:"0%";const c=a.querySelector("[data-progress]");c.max=String(i),c.value=String(Math.min(o,i)),c.disabled=i===0||d,c.setAttribute("aria-valuetext",`${v(Math.min(o,i))} of ${v(i)}`);const g=a.querySelector("[data-now-phases]"),f=Array.isArray(e.arrangement)?e.arrangement:[];g.innerHTML=f.map((S,k)=>{const h=W(S.at),b=k+1<f.length?W(f[k+1].at):i;return`
        <button type="button" class="pp-phase ${l&&o>=h&&o<b?"is-current":""}"
          data-action="seek" data-seconds="${h}">
          ${u(S.phase)}<small>${u(S.at)}</small>
        </button>
      `}).join(""),a.querySelector("[data-status-line]").textContent=t.status==="error"?t.lastError??"Playback error.":"",D.setPosition(o,s),l?F.start():d||F.stop()}function x(){Ht(),J();const e=M.getState().status==="playing";e&&P===null?P=setInterval(J,500):!e&&P!==null&&(clearInterval(P),P=null)}function K(t){var l,d,o;const e=m.querySelector("[data-meta]"),a=((l=t.soundPalette)==null?void 0:l.families)??{},n=((d=t.rights)==null?void 0:d.samples)??[],i=E(t),s=U(t);e.innerHTML=`
    ${I(s)?`<img class="pp-meta-artwork" src="${u(s.src)}"
            alt="${u(s.alt)}"
            style="object-position: ${N(s)}" />`:""}
    <header class="pp-meta-head">
      <div>
        <p class="pp-eyebrow">${G(t).label} · ${z[t.status]??t.status}</p>
        <h2 id="player-meta-title">${u(t.title)}</h2>
      </div>
      <button type="button" data-action="close-meta">Close</button>
    </header>
    <p class="pp-meta-desc">${u(t.description||"No description yet.")}</p>
    <dl class="pp-meta-facts">
      <div><dt>Tempo</dt><dd>${t.bpm} BPM</dd></div>
      <div><dt>Duration</dt><dd>${v(i)}</dd></div>
      ${(o=t.tags)!=null&&o.length?`<div><dt>Tags</dt><dd>${t.tags.map(u).join(", ")}</dd></div>`:""}
    </dl>
    ${Object.keys(a).length?`<h3>Sound families</h3>
           <ul class="pp-meta-families">
             ${Object.entries(a).map(([p,r])=>`<li><strong>${u(p)}</strong> ${u(r)}</li>`).join("")}
           </ul>`:""}
    ${n.length?`<h3>Samples</h3>
           <ul class="pp-meta-families">
             ${n.map(p=>`<li><strong>${u(p.license)}</strong> ${u(p.name)} (${u(p.source)})</li>`).join("")}
           </ul>`:""}
  `,e.showModal()}m.addEventListener("click",async t=>{var l,d;const e=t.target.closest('[data-action="meta"]');if(e){t.stopPropagation();const o=C.find(p=>p.id===e.dataset.id);o&&K(o);return}const a=t.target.closest("[data-action]");if(!a)return;const{action:n}=a.dataset,i=M.getState(),s=L();if(n==="pick"){const o=a.dataset.id;if(((l=i.activeTrack)==null?void 0:l.id)===o&&i.status==="playing"){await M.stop(),x();return}V=o,rt(C.find(r=>r.id===o)),await A(Y(o)),x();return}if(n==="toggle"){i.status==="playing"?await M.stop():await A(Y(s==null?void 0:s.id)),x();return}if(n==="reset"){await M.reset(),x();return}if(n==="seek"){await A(Number(a.dataset.seconds));return}if(n==="back30"||n==="fwd30"){const o=n==="back30"?-30:30,p=((d=i.activeTrack)==null?void 0:d.id)===(s==null?void 0:s.id)?i.elapsedSeconds:0;await A(Math.max(0,p+o));return}if(n==="show-meta"&&s){K(s);return}n==="close-meta"&&m.querySelector("[data-meta]").close()});m.querySelector("[data-progress]").addEventListener("input",t=>{const e=L(),a=e?E(e):0;if(!e||a===0)return;const n=Number(t.currentTarget.value);m.querySelector("[data-progress-fill]").style.width=`${n/a*100}%`,m.querySelector("[data-clock]").textContent=`${v(n)} / ${v(a)}`,t.currentTarget.setAttribute("aria-valuetext",`${v(n)} of ${v(a)}`)});m.querySelector("[data-progress]").addEventListener("change",async t=>{await A(Number(t.currentTarget.value))});x();rt(L());wt(at).then(t=>{t.updated>0&&x()});
