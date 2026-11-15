import{a as R,p as C,D as Se,S as ke,h as x,i as Y,A as U,P as we,b as V,c as Te,d as Ce,e as Me,f as Le,g as $,j as N,k as Pe,l as Ae,s as qe,m as Ie,n as Ee,M as oe,r as A,o as K,q as G,t as xe,u as B,v as De,w as Ne}from"./attribution-CQShap8b.js";const ee=R("samples/library/strudel-samples.json"),Oe=R("samples/library/library.json"),Fe=["all","pulse","skin","seed","tremor","memory","ground"];function te(e){return e.note?`note("${e.note}").s("${e.bank}")`:e.index>0?`s("${e.bank}:${e.index}")`:`s("${e.bank}")`}async function je(e=fetch){const t=await e(Oe);if(!t.ok)throw new Error(`sample library manifest not available (HTTP ${t.status})`);return t.json()}function Be(e,{family:t="all",term:a=""}={}){const s=a.trim().toLowerCase();return e.filter(r=>t!=="all"&&r.family!==t?!1:s===""?!0:[r.bank,r.title,r.creator,r.license].filter(Boolean).some(i=>i.toLowerCase().includes(s)))}function He(e){const t={manifest:null,error:null,family:"all",term:"",playingId:null};function a(){t.playingId=null}function s(b){a()}function r(b){return String(b??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function i(){e.innerHTML=`
      <header class="inspector-header">
        <div>
          <p class="eyebrow">Sample Library</p>
          <h2>Local CC0 Sounds</h2>
        </div>
        <div class="inspector-actions">
          <button type="button" data-samples-action="copy-setup">Copy setup line</button>
          <button type="button" data-samples-action="close">Close</button>
        </div>
      </header>
      <p class="inspector-hint">
        Load the map in any piece with
        <code>samples('${ee}')</code>, then play a sound via its snippet.
        Every file is CC0 with recorded provenance (see <code>sample-library/manifests/</code>).
      </p>
      <div class="samples-controls">
        <nav class="samples-families" aria-label="Filter by sound family"></nav>
        <input type="search" data-samples-search placeholder="Search banks, titles, creators…"
          aria-label="Search samples" />
      </div>
      <div class="samples-list" data-samples-list></div>
    `}function c(){const b=e.querySelector(".samples-families");b.innerHTML=Fe.map(h=>`
        <button type="button" data-samples-action="family" data-family="${h}"
          class="${t.family===h?"is-active":""}">${h}</button>
      `).join("")}function n(){const b=e.querySelector("[data-samples-list]");if(t.error){b.innerHTML=`
        <p class="group-hint">
          ${r(t.error)} — run
          <code>npm run samples:build</code> to generate the library.
        </p>
      `;return}if(!t.manifest){b.innerHTML='<p class="group-hint">Loading…</p>';return}const h=Be(t.manifest.entries,t),l=new Map;for(const y of h)l.has(y.bank)||l.set(y.bank,[]),l.get(y.bank).push(y);if(l.size===0){b.innerHTML='<p class="group-hint">No samples match the current filter.</p>';return}const k=`
        <p class="inspector-hint samples-notice" role="note">
          The sample audio is not installed here, so previews are off. The banks and
          snippets below show what the library contains. In a local copy, run
          <code>./setup.sh</code> without <code>--no-samples</code> to download it.
        </p>
      `;b.innerHTML=k+[...l.entries()].map(([y,w])=>`
          <section class="samples-bank">
            <header class="samples-bank-header">
              <h3>${r(y)}</h3>
              <span class="samples-bank-meta">
                ${r(w[0].family)} · ${w.length}
                ${w.length===1?"sound":"sounds"}
              </span>
            </header>
            <ul class="samples-entries">
              ${w.map(g=>`
                    <li class="samples-entry ${t.playingId===g.id?"is-playing":""}">
                      <button type="button" class="samples-play"
                        data-samples-action="preview" data-sample-id="${g.id}"
                        aria-label="Preview ${r(g.title)}"
                        disabled title="Sample audio is not installed">
                        ${t.playingId===g.id?"■":"▶"}
                      </button>
                      <div class="samples-entry-main">
                        <code>${r(te(g))}</code>
                        <small>
                          ${r(g.title)}
                          ${g.durationSeconds?` · ${g.durationSeconds}s`:""}
                          · ${r(g.license)}
                          ${g.canonicalUrl?` · <a href="${r(g.canonicalUrl)}" target="_blank" rel="noreferrer">source</a>`:""}
                        </small>
                      </div>
                      <button type="button" data-samples-action="copy" data-sample-id="${g.id}">
                        Copy
                      </button>
                    </li>
                  `).join("")}
            </ul>
          </section>
        `).join("")}async function o(){if(e.open||(i(),c(),n(),e.showModal()),!t.manifest&&!t.error){try{t.manifest=await je()}catch(b){t.error=b.message}n()}}function S(){a(),e.open&&e.close()}return e.addEventListener("click",async b=>{var y,w,g;const h=b.target.closest("[data-samples-action]");if(!h)return;const l=h.dataset.samplesAction;if(l==="close"){S();return}if(l==="family"){t.family=h.dataset.family,c(),n();return}if(l==="copy-setup"){await((y=navigator.clipboard)==null?void 0:y.writeText(`samples('${ee}')`));return}const k=(w=t.manifest)==null?void 0:w.entries.find(O=>O.id===h.dataset.sampleId);if(k){if(l==="preview"){t.playingId===k.id?a():s(),n();return}l==="copy"&&await((g=navigator.clipboard)==null?void 0:g.writeText(te(k)))}}),e.addEventListener("input",b=>{b.target.matches("[data-samples-search]")&&(t.term=b.target.value,n())}),e.addEventListener("close",a),{open:o,close:S}}var ie;const m={selectedPieceId:((ie=C[0])==null?void 0:ie.id)??null,searchTerm:"",statusFilter:"all",libraryOpen:!1,notice:null,scrubPreviewSeconds:null};let ae=null;const Ue=240,Re=60,f=document.querySelector("#root");f.innerHTML=`
  <main class="app-shell" id="studio-main" tabindex="-1">
    <header class="topbar">
      <div class="topbar-identity">
        ${x(B.profileImage)?`<img class="topbar-profile-image" src="${u(B.profileImage.src)}"
                alt="${u(B.profileImage.alt)}"
                style="object-position: ${Y(B.profileImage)}" />`:""}
        <div class="topbar-title">
          <p class="eyebrow">Track Forge</p>
          <h1>Turn live-coded patterns into complete tracks</h1>
          <p class="topbar-motto">${U==="demo"?"Arrange, audition and inspect a Strudel track. This demo runs the example track in your browser.":"Arrange, audition and inspect your music while every track stays in plain local files."}</p>
        </div>
      </div>
      <nav class="topbar-actions" aria-label="Workspace destinations">
        <button class="library-toggle" type="button" data-action="toggle-library"
          aria-expanded="false" aria-controls="library-panel">
          Tracks
        </button>
        <a class="topbar-link" href="${R("player.html")}">Listening player</a>
        <button class="samples-toggle" type="button" data-action="open-samples">
          Samples
        </button>
        <span class="track-count">${C.length} ${C.length===1?"track":"tracks"}</span>
      </nav>
    </header>

    <div class="workspace">
      <aside class="library" id="library-panel" aria-label="Track library">
        <div class="library-drawer-head">
          <strong>Track library</strong>
          <button type="button" data-action="toggle-library" aria-label="Close track library">Close</button>
        </div>
        <div class="library-controls">
          <input type="search" data-library-search placeholder="Search tracks…"
            aria-label="Search tracks by title or tag" />
          <select data-status-filter aria-label="Filter tracks by lifecycle status">
            <option value="all">All statuses</option>
            ${we.map(e=>`<option value="${e}">${V[e]}</option>`).join("")}
          </select>
        </div>
        <section class="library-group">
          <h2 class="eyebrow library-heading">Tracks</h2>
          <div class="track-list" data-track-list></div>
        </section>
      </aside>

      <section class="stage" aria-label="Listening workspace">
        ${U==="demo"?`<p class="mode-notice" data-mode-notice>
                <strong>${Se.studio}</strong>
                To edit your own tracks and save them as files, <a href="${ke}#fastest-start">run Track Forge locally</a>.
              </p>`:""}
        <section class="product-intro" aria-labelledby="product-intro-title">
          <div class="product-intro-copy">
            <p class="eyebrow">See what the code is doing</p>
            <h2 id="product-intro-title">From Strudel pattern to a track you can understand.</h2>
            <p>
              Track Forge turns each track folder into a visual arrangement, a safe place to audition edits
              and a focused player for phones on your local network.
            </p>
          </div>
          <ol class="product-path" aria-label="Track Forge workflow">
            <li><span aria-hidden="true">1</span><strong>Listen</strong><small>Play the full arrangement.</small></li>
            <li><span aria-hidden="true">2</span><strong>Explore</strong><small>Follow and mute real layers.</small></li>
            <li><span aria-hidden="true">3</span><strong>Edit safely</strong><small>Try source before saving.</small></li>
          </ol>
        </section>
        <header class="track-header" data-track-header></header>
        <p class="notice" data-notice role="status" hidden></p>
        <section class="stage-panel" data-stage-panel></section>
        <div class="track-details" data-track-details></div>
        ${Te("attribution")}
      </section>
    </div>

    <footer class="transport" data-transport aria-label="Playback transport"></footer>
  </main>

  <dialog class="inspector" data-inspector aria-labelledby="source-inspector-title">
    <header class="inspector-header">
      <div>
        <p class="eyebrow">Source Inspector</p>
        <h2 id="source-inspector-title" data-inspector-title></h2>
      </div>
      <div class="inspector-actions">
        <button type="button" data-action="copy-source">Copy</button>
        <button type="button" data-action="close-inspector">Close</button>
      </div>
    </header>
    <p class="inspector-hint">
      Paste or edit Strudel here. Try Draft changes playback only; it does not touch the file on disk.
    </p>
    <textarea class="inspector-editor" data-inspector-editor aria-label="Editable Strudel source"
      spellcheck="false" wrap="off"></textarea>
    <div class="inspector-workflow">
      <button type="button" data-action="try-source">Try Draft</button>
      <button type="button" data-action="prepare-source-save" disabled>Prepare Overwrite</button>
      <span data-inspector-state role="status">Disk source loaded. No changes.</span>
    </div>
    <section class="source-confirm" data-source-confirm hidden>
      <p>
        This permanently replaces <code data-source-path></code>. The draft must still match the
        version you just tried.
      </p>
      <label>
        Editor token
        <input type="password" data-source-token autocomplete="current-password" />
      </label>
      <div class="source-confirm-actions">
        <button type="button" data-action="confirm-source-save">Confirm Overwrite</button>
        <button type="button" data-action="cancel-source-save">Cancel</button>
      </div>
    </section>
  </dialog>

  <dialog class="shortcuts" data-shortcuts aria-labelledby="shortcut-dialog-title">
    <header class="inspector-header">
      <div>
        <p class="eyebrow">Keyboard</p>
        <h2 id="shortcut-dialog-title">Shortcuts</h2>
      </div>
      <button type="button" data-action="close-shortcuts">Close</button>
    </header>
    <dl class="shortcut-list">
      <div><dt>Space</dt><dd>Play or stop; Play continues where Stop left off</dd></div>
      <div><dt>Shift + Space</dt><dd>Back to start</dd></div>
      <div><dt>Escape</dt><dd>Stop all playback; the position is kept</dd></div>
    </dl>
    <p class="inspector-hint">Shortcuts are ignored while typing in a text field.</p>
  </dialog>

  <dialog class="inspector samples" data-samples aria-label="Sample library browser"></dialog>

  <div class="engine-rack" aria-hidden="true" data-engine-rack></div>
  <span class="sr-only" role="status" aria-live="polite" data-live></span>
`;const _e=document.querySelector("[data-engine-rack]"),We=He(document.querySelector("[data-samples]"));function ze({sync:e}){const t=document.createElement("strudel-editor");return t.sync=e,t.solo=!1,t.setAttribute("code","silence"),_e.append(t),Ee(t)}Ce();const v=Me({engines:{full:ze({sync:!1}),channels:[]},onChange:Qe,hooks:{onSilence:Ne,onWake:De}});let J={available:!1,writeEnabled:!1},p=null;const le=Le(C).then(e=>(J=e,e)),H=new Map;function Q(e){return H.has(e)?H.get(e):(H.set(e,null),fetch(R(`timeline-previews/${e}.json`)).then(t=>t.ok?t.json():null).then(t=>{t&&(H.set(e,t),D())}).catch(()=>{}),null)}function Ye(e,t,a=.5){return t==="wave"?`hsla(${18+a*26}, 62%, ${30+a*22}%, ${e})`:t==="center"?`rgba(31, 28, 24, ${e})`:t==="tick"?`rgba(142, 94, 37, ${e})`:`rgba(23, 79, 69, ${Math.min(1,e+.15)})`}function ce(){const e=L();if(!e)return;const t=Q(e.id);if(!t)return;const a=t.bars*t.stepsPerBar;f.querySelectorAll(".timeline-lane").forEach((s,r)=>{const i=s.dataset.layerId,c=t.lanes.find(b=>b.label===i)??t.lanes[r];if(!c||s.clientWidth===0)return;let n=s.querySelector(".timeline-lane-canvas");n||(n=document.createElement("canvas"),n.className="timeline-lane-canvas",n.setAttribute("aria-hidden","true"),s.prepend(n));const o=window.devicePixelRatio||1;n.width=Math.max(1,Math.round(s.clientWidth*o)),n.height=Math.max(1,Math.round(s.clientHeight*o));const S=n.getContext("2d");S.clearRect(0,0,n.width,n.height),xe(S,c,{x:0,y:0,width:n.width,height:n.height,ratio:o,totalSteps:a,color:Ye})})}function D(){_(),Ve(),de(),Je(),ue(),ce()}function _(){const e=m.searchTerm.trim().toLowerCase(),t=C.filter(s=>m.statusFilter!=="all"&&s.status!==m.statusFilter?!1:e?`${s.title} ${s.tags.join(" ")}`.toLowerCase().includes(e):!0),a=f.querySelector("[data-track-list]");a.innerHTML=t.length?t.map(s=>{var o;const r=s.id===m.selectedPieceId,i=v.getState(),c=i.mode==="full"&&((o=i.activeTrack)==null?void 0:o.id)===s.id&&(i.status==="playing"||i.status==="loading"),n=!!N(s);return`
            <span class="track-row">
            <button class="track-card-play${c?" is-playing":""}" type="button"
              data-action="card-play" data-piece-id="${s.id}" ${n?"":"disabled"}
              aria-label="${c?"Stop":"Play"} ${u(s.title)}">
              ${c?"■":"▶"}
            </button>
            <button class="track-button${r?" is-active":" is-compact"}" type="button"
              data-action="select-piece" data-piece-id="${s.id}"
              title="${u(s.title)}"
              ${r?'aria-current="true"':""}>
              ${x(A(s))?`<img class="track-button-artwork" src="${u(A(s).src)}"
                      alt="" style="object-position: ${Y(A(s))}" />`:""}
              <span class="track-button-copy">
                <strong>${r?'<span aria-hidden="true">● </span>':""}${u(s.title)}</strong>
                <small>${V[s.status]} · ${s.bpm} BPM</small>
                ${s.tags.length?`<em>${u(s.tags.slice(0,4).join(", "))}</em>`:""}
              </span>
            </button>
            </span>
          `}).join(""):`<p class="empty-state">${C.length?"No tracks match the current filter.":"No tracks were discovered under src/pieces."}</p>`}function Ve(){const e=L(),t=f.querySelector("[data-track-header]");if(!e){t.classList.remove("has-artwork"),t.innerHTML='<p class="empty-state">Select a track from the library.</p>';return}t.classList.toggle("has-artwork",x(A(e)));const a=G(e.durationTargetMinutes),s=N(e),r=K(e).length;t.innerHTML=`
    ${x(A(e))?`<img class="track-header-artwork" src="${u(A(e).src)}"
            alt="${u(A(e).alt)}"
            style="object-position: ${Y(A(e))}" />`:""}
    <div class="track-header-copy">
      <div class="track-header-main">
        <div>
          <p class="eyebrow">Selected Track</p>
          <h2>${u(e.title)}</h2>
        </div>
        <span class="status-pill">${V[e.status]}</span>
      </div>
      <p class="track-header-meta">
        ${e.bpm} BPM · v${u(e.version)}${a?` · ${a}`:""}
        ${s?` · full arrangement + ${r} standalone ${r===1?"layer":"layers"}`:` · ${r} standalone ${r===1?"scene":"scenes"}, no full arrangement`}
      </p>
      ${e.tags.length?`<p class="track-header-tags">${u(e.tags.join(" · "))}</p>`:""}
      ${e.description?`<p class="track-header-description">${u(e.description)}</p>`:""}
    </div>
  `}function de(){const e=L(),t=f.querySelector("[data-stage-panel]"),a=v.getState();if(!e){t.innerHTML=`<p class="empty-state">${C.length?"Select a track from the library.":"No tracks were discovered under src/pieces."}</p>`;return}t.innerHTML=Ke(e,a)}function Ke(e,t){var n;const a=N(e),s=K(e),r=G(e.durationTargetMinutes),i=t.mode==="full"&&((n=t.activeTrack)==null?void 0:n.id)===e.id&&(t.status==="playing"||t.status==="loading"),c=Array.isArray(e.arrangement)?e.arrangement.filter(o=>o&&o.phase):[];return`
    <div class="full-panel">
      <div class="full-panel-primary">
        <button type="button" class="play-hero" data-action="play-full" ${a?"":"disabled"}>
          <span class="play-hero-icon" aria-hidden="true">${i?"■":"▶"}</span>
          <span>${i?"Stop Full Track":"Play Full Track"}</span>
        </button>
        <div class="full-panel-facts">
          <p class="full-panel-name">${a?"<code>main.strudel</code> — the complete arrangement":u(oe.noMainScene)}</p>
          <p class="full-panel-meta">${e.bpm} BPM${r?` · target ${r}`:""}</p>
          ${a?`<button type="button" class="link-button" data-action="view-source"
                  data-source-kind="scene" data-piece-id="${e.id}" data-scene-id="main">
                  View main source
                </button>`:""}
        </div>
      </div>

      ${Ge(e,s,t,c,!!a)}

      <div class="included-layers">
        <p class="eyebrow">${s.length?"Included Layers":"Layers"}</p>
        ${s.length?`
              <p class="group-hint">Mute or unmute layers live in the timeline below; view any layer's source here.</p>
              <ul class="layer-chip-list">
                ${s.map(o=>`
                      <li class="layer-chip">
                        <div class="layer-chip-text">
                          <strong>${u(o.name)}</strong>
                          ${z(e,o.id)?`<small>${u(z(e,o.id))}</small>`:""}
                        </div>
                        <span class="layer-chip-actions">
                          <button type="button" data-action="view-source"
                            data-source-kind="scene" data-piece-id="${e.id}" data-scene-id="${o.id}">
                            Source
                          </button>
                        </span>
                      </li>
                    `).join("")}
              </ul>
            `:'<p class="empty-state">This track only contains a full arrangement.</p>'}
      </div>
    </div>
  `}function Ge(e,t,a,s,r){var h;const i=ye(e);if(t.length===0)return"";const n=a.mode==="full"&&((h=a.activeTrack)==null?void 0:h.id)===e.id?Math.min(a.elapsedSeconds,i):0,o=Math.min(100,Math.max(0,n/i*100)),S=s.map(l=>({...l,seconds:ge(l.at)})).filter(l=>l.seconds>=0&&l.seconds<=i);return`
    <section class="song-timeline" aria-label="Interactive layer timeline">
      <header class="timeline-header">
        <div>
          <p class="eyebrow">Layer Timeline</p>
          <p class="group-hint">${S.length?"Drag across the lanes or choose a phase. Audio restarts at the selected musical position.":"Drag across the lanes to restart the arrangement at the selected musical position."}</p>
        </div>
        <div class="timeline-actions">
          <button type="button" data-action="seek-relative" data-seconds="-30" ${r?"":"disabled"}>
            −30 sec
          </button>
          <output class="timeline-position" data-timeline-position aria-label="Current track position">
            ${$(n)} / ${$(i)}
          </output>
          <button type="button" data-action="seek-relative" data-seconds="30" ${r?"":"disabled"}>
            +30 sec
          </button>
        </div>
      </header>

      <div class="timeline-ruler-row">
        <span class="timeline-axis-label">Position</span>
        <div class="timeline-ruler">
          ${S.map((l,k)=>`
                <button type="button" class="timeline-marker${k===0?" is-first":""}"
                  data-action="seek-to" data-seconds="${l.seconds}"
                  style="--marker: ${l.seconds/i*100}%"
                  title="Start ${u(l.phase)} at ${u(l.at||$(l.seconds))}">
                  <span>${u(l.phase)}</span>
                  <small>${u(l.at||$(l.seconds))}</small>
                </button>
              `).join("")}
        </div>
      </div>

      <div class="timeline-body">
        <div class="timeline-layer-labels">
          ${t.map(l=>{const k=ne(e,l.id,i);return`
                <div class="timeline-layer-label${q(e.id,l.id)?" is-muted":""}">
                  <span>
                    <strong>${u(l.name)}</strong>
                    <small>${u($e(k.family))}</small>
                  </span>
                  <button type="button" data-action="toggle-layer-mute"
                    data-piece-id="${e.id}" data-scene-id="${l.id}"
                    class="layer-mute${q(e.id,l.id)?" is-muted":""}"
                    aria-label="${q(e.id,l.id)?"Unmute":"Mute"} ${u(l.name)}"
                    aria-pressed="${q(e.id,l.id)}"
                    ${Ze(e)?"":"disabled"}
                    title="${q(e.id,l.id)?"Unmute":"Mute"} ${u(l.name)} — playback continues">
                    <span aria-hidden="true">${q(e.id,l.id)?"🔇":"🔊"}</span>
                  </button>
                </div>
              `}).join("")}
        </div>

        <div class="timeline-canvas" style="--playhead: ${o}%">
          <div class="timeline-lanes">
            ${t.map(l=>{const k=ne(e,l.id,i);return`
                  <div class="timeline-lane${q(e.id,l.id)?" is-muted":""}"
                    data-family="${u(k.family)}"
                    data-layer-id="${u(l.id)}">
                    ${k.segments.map(y=>{const w=y.from/i*100,g=(y.to-y.from)/i*100;return`
                          <span class="timeline-segment${y.active===!1?" is-inactive":""}"
                            style="left: ${w}%; width: ${g}%"
                            title="${u(y.label)} · ${$(y.from)}–${$(y.to)}">
                            <span>${u(y.label)}</span>
                          </span>
                        `}).join("")}
                  </div>
                `}).join("")}
          </div>
          <div class="timeline-playhead" aria-hidden="true">
            <span data-timeline-playhead-clock>${$(n)}</span>
          </div>
          <input class="timeline-scrubber" type="range" min="0" max="${i}" step="1"
            value="${Math.min(n,i)}" data-song-position
            aria-label="Song position"
            aria-valuetext="${$(n)} of ${$(i)}"
            ${r?"":"disabled"} />
        </div>
      </div>
    </section>
  `}function Je(){var c,n,o,S,b;const e=L(),t=f.querySelector("[data-track-details]");if(!e){t.innerHTML="";return}const a=ct(e),s=(c=e.soundPalette)==null?void 0:c.families,r=(n=e.artwork)==null?void 0:n.rights,i=s&&typeof s=="object"?`
        <details>
          <summary>Sound Palette</summary>
          <dl class="fact-list">
            ${Object.entries(s).map(([h,l])=>d($e(h),l)).join("")}
          </dl>
        </details>
      `:"";t.innerHTML=`
    ${i}
    <details>
      <summary>Track Details</summary>
      <dl class="fact-list">
        ${d("Artist",e.artist)}
        ${d("Recording type",e.instrumental?"Instrumental":"Contains vocals")}
        ${d("Version",`v${e.version}`)}
        ${d("Duration target",e.durationTargetMinutes?`${e.durationTargetMinutes} min`:"")}
        ${d("Next step",e.workflow.nextStep)}
        ${d("Last reviewed",e.workflow.lastReviewedAt)}
      </dl>
    </details>
    <details>
      <summary>Release Preparation</summary>
      <ul class="check-list">
        ${a.map(h=>`
              <li class="${h.ok?"is-ok":"is-missing"}">
                <span aria-hidden="true">${h.ok?"✓":"!"}</span>
                ${h.label}
              </li>
            `).join("")}
      </ul>
      <p class="group-hint">These are documentation checks, not legal certification.</p>
    </details>
    <details>
      <summary>Rights Documentation</summary>
      <dl class="fact-list">
        ${d("Distribution mode",I(e.release.distributionMode))}
        ${d("Label",e.release.label)}
        ${d("Monetization",e.release.monetizationEnabled?"Enabled":"Disabled")}
        ${d("YouTube Content ID",e.release.youtubeContentIdEnabled?"Enabled":"Disabled")}
        ${d("Composition owner",e.rights.compositionOwner)}
        ${d("Composition status",I(e.rights.review.compositionStatus))}
        ${d("Human contribution",e.rights.review.humanContributionDocumented?"Documented":"Not documented")}
        ${d("Master owner",e.rights.masterOwner)}
        ${d("Master status",I(e.rights.review.masterStatus))}
        ${d("AI assisted",e.rights.aiAssisted?"Yes":"No")}
        ${d("AI terms review",e.rights.review.aiTermsChecked?"Completed":"Not completed")}
        ${d("Sample sources",dt(e.rights.samples))}
        ${d("Sample-use review",e.rights.review.sampleUseChecked?"Completed":"Not completed")}
        ${d("Content ID status",I(e.rights.review.contentIdStatus))}
        ${d("Commercial-use review",e.rights.commercialUseChecked?"Documented as checked":"Not completed")}
        ${d("Review notes",e.rights.review.notes)}
      </dl>
    </details>
    <details>
      <summary>Artwork Documentation</summary>
      <dl class="fact-list">
        ${d("Visual brief",(o=e.artwork)==null?void 0:o.brief)}
        ${d("Image file",(S=e.artwork)==null?void 0:S.src)}
        ${d("Alt text",(b=e.artwork)==null?void 0:b.alt)}
        ${d("Creator",r==null?void 0:r.creator)}
        ${d("Source",r==null?void 0:r.source)}
        ${d("License or permission",r==null?void 0:r.license)}
        ${d("AI assisted",(r==null?void 0:r.aiAssisted)===null||(r==null?void 0:r.aiAssisted)===void 0?"Not documented":r.aiAssisted?"Yes":"No")}
        ${d("AI tool",r==null?void 0:r.aiTool)}
        ${d("AI terms review",r!=null&&r.termsChecked?"Completed":"Not completed")}
        ${d("Commercial-use review",r!=null&&r.commercialUseChecked?"Documented as checked":"Not completed")}
      </dl>
      <p class="group-hint">Artwork rights are separate from composition and master rights.</p>
    </details>
  `}function ue(){var Z;const e=v.getState(),t=L(),a=f.querySelector("[data-transport]"),s={idle:"Idle",loading:"Loading…",playing:"Playing",stopped:"Stopped",error:"Error"},r=t?N(t):null,i=e.channels.filter(Boolean).length,c=e.mode==="lab"&&i>0,n=e.status==="playing"||e.status==="loading",o=e.mode==="full"&&n&&((Z=e.activeTrack)==null?void 0:Z.id)===(t==null?void 0:t.id),S=n&&(e.mode==="lab"||o||e.mode==="full"&&!r),b=S?"■":"▶",h=S?"Stop":e.mode==="full"?"Play Full Track":"Play Layers",l=e.mode==="full"?!!r||n:c||n,k=n||e.mode==="full"&&e.status==="stopped"&&e.elapsedSeconds>0,y=e.mode==="full"?n&&e.activeTrack?`${e.activeTrack.title} — full arrangement`:t?`${t.title} — full arrangement`:"No track selected":`Layer Lab session (${i} ${i===1?"layer":"layers"})`,w=n&&e.activeTrack?e.activeTrack:t,g=e.mode==="full"?W(w):null,O=e.mode==="full"?g?$(g):G(w==null?void 0:w.durationTargetMinutes):null;a.innerHTML=`
    <div class="transport-inner">
      <div class="transport-buttons">
        <button type="button" class="transport-play" data-action="transport-toggle"
          ${l?"":"disabled"}>
          <span aria-hidden="true">${b}</span>
          <span>${h}</span>
        </button>
        <button type="button" class="transport-reset" data-action="transport-reset" ${k?"":"disabled"}
          aria-label="Back to start" title="Back to start (Shift + Space)"><span aria-hidden="true">⏮</span><span class="transport-reset-label"> Back to start</span></button>
      </div>
      <div class="transport-now">
        <strong>${u(y)}</strong>
        <small>${e.mode==="full"?"Full Track mode":"Layer Lab mode"}</small>
      </div>
      <div class="transport-clock">
        <span data-elapsed>${$(e.elapsedSeconds)}</span>${O?` / ${O}`:""}
      </div>
      <span class="status-pill transport-status is-${e.status}">${s[e.status]}</span>
      <button type="button" class="shortcut-button" data-action="open-shortcuts">? Keys</button>
    </div>
    ${e.lastError?`
          <div class="transport-error" role="alert">
            <span>${u(e.lastError)} Open the source inspector or browser console for technical details.</span>
            <button type="button" data-action="dismiss-error">Dismiss</button>
          </div>
        `:""}
  `}setInterval(()=>{var s,r;const e=v.getState();if(e.status!=="playing")return;const t=f.querySelector("[data-elapsed]");t&&(t.textContent=$(e.elapsedSeconds));const a=L();m.scrubPreviewSeconds===null&&e.mode==="full"&&((s=e.activeTrack)==null?void 0:s.id)===(a==null?void 0:a.id)&&ve(e.elapsedSeconds),e.mode==="full"&&((r=e.activeTrack)!=null&&r.durationSeconds)&&e.elapsedSeconds>=e.activeTrack.durationSeconds&&v.stop()},500);let se=null;function Qe(e){var t;if(_(),de(),ue(),ce(),e.status!==se){se=e.status;const a={idle:"",loading:"Loading playback.",playing:e.mode==="full"?`Playing ${((t=e.activeTrack)==null?void 0:t.title)??"track"}, full arrangement.`:"Playing Layer Lab session.",stopped:e.mode==="full"&&e.elapsedSeconds>0?`Playback stopped at ${$(e.elapsedSeconds)}. Play continues from there.`:"Playback stopped.",error:"Playback error. See the transport bar for details."};document.querySelector("[data-live]").textContent=a[e.status]??""}}document.addEventListener("click",async e=>{var s,r,i,c;const t=e.target.closest("button[data-action]");if(!t)return;const{action:a}=t.dataset;if(a==="select-piece"){const n=window.matchMedia("(max-width: 920px)").matches;if(m.selectedPieceId=t.dataset.pieceId,m.libraryOpen=!1,j(),D(),n){const o=f.querySelector("[data-track-header] h2");o==null||o.setAttribute("tabindex","-1"),o==null||o.focus()}return}if(a==="toggle-library"){m.libraryOpen=!m.libraryOpen,j(),m.libraryOpen?(s=f.querySelector("[data-library-search]"))==null||s.focus():(r=f.querySelector(".library-toggle"))==null||r.focus();return}if(a==="open-samples"){await We.open();return}if(a==="card-play"){const n=t.dataset.pieceId,o=v.getState();if(o.mode==="full"&&((i=o.activeTrack)==null?void 0:i.id)===n&&(o.status==="playing"||o.status==="loading")){await v.stop();return}m.selectedPieceId=n,D(),await E(me(n));return}if(a==="toggle-layer-mute"){await at(t.dataset.pieceId,t.dataset.sceneId);return}if(a==="play-full"||a==="transport-toggle"){await pe();return}if(a==="transport-reset"){const n=await v.reset();!n.ok&&n.message&&P(n.message);return}if(a==="seek-to"){await E(Number(t.dataset.seconds));return}if(a==="seek-relative"){const n=L(),o=v.getState(),S=o.mode==="full"&&((c=o.activeTrack)==null?void 0:c.id)===(n==null?void 0:n.id)?o.elapsedSeconds:0;await E(S+Number(t.dataset.seconds));return}if(a==="view-source"){await st(t.dataset);return}if(a==="copy-source"){const n=document.querySelector("[data-inspector-editor]").value;try{await navigator.clipboard.writeText(n),P("Source copied to the clipboard.")}catch{P("Copying failed. Select the text manually instead.")}return}if(a==="try-source"){await nt();return}if(a==="prepare-source-save"){it();return}if(a==="confirm-source-save"){await ot(t);return}if(a==="cancel-source-save"){document.querySelector("[data-source-confirm]").hidden=!0,T("Permanent overwrite cancelled. The draft remains in the editor.");return}if(a==="close-inspector"){document.querySelector("[data-inspector]").close();return}if(a==="open-shortcuts"){document.querySelector("[data-shortcuts]").showModal();return}if(a==="close-shortcuts"){document.querySelector("[data-shortcuts]").close();return}a==="dismiss-error"&&v.clearError()});f.addEventListener("input",e=>{if(e.target.matches("[data-inspector-editor]")){X();return}if(e.target.matches("[data-library-search]")){m.searchTerm=e.target.value,_();return}e.target.matches("[data-song-position]")&&(m.scrubPreviewSeconds=Number(e.target.value),ve(m.scrubPreviewSeconds))});f.addEventListener("change",async e=>{if(e.target.matches("[data-status-filter]")){m.statusFilter=e.target.value,_();return}if(e.target.matches("[data-song-position]")){const t=Number(e.target.value);m.scrubPreviewSeconds=null,await E(t)}});async function pe(){var i;const e=v.getState(),t=L(),a=e.status==="playing"||e.status==="loading",s=!!(t&&N(t));if(a&&((i=e.activeTrack)==null?void 0:i.id)===(t==null?void 0:t.id)||a&&!s){await v.stop();return}await E(me(t==null?void 0:t.id))}function me(e){var a;const t=v.getState();return t.mode==="full"&&t.status==="stopped"&&((a=t.activeTrack)==null?void 0:a.id)===e?t.elapsedSeconds:0}const F=new Map;function Xe(e){return F.has(e)||F.set(e,new Set),F.get(e)}function q(e,t){var a;return((a=F.get(e))==null?void 0:a.has(t))??!1}function Ze(e){var t,a;return!!((a=(t=Q(e.id))==null?void 0:t.lanes)!=null&&a.some(s=>s.orbit!==void 0))}function et(e){const t=F.get(e.id),a=Q(e.id);if(!t||t.size===0||!a)return[];const s=K(e);return a.lanes.filter((r,i)=>{const n=s.find(o=>o.id===r.label)??s[i];return n&&t.has(n.id)&&r.orbit!==void 0}).map(r=>r.orbit)}function tt(e,t){return t.length===0?e:`${e.trim().replace(/;\s*$/,"")}
  .filterValues((v) => ![${t.join(", ")}].includes(v?.orbit ?? -1))`}async function at(e,t){var c;if(!C.find(n=>n.id===e))return;const s=Xe(e);s.has(t)?s.delete(t):s.add(t);const r=v.getState();r.mode==="full"&&((c=r.activeTrack)==null?void 0:c.id)===e&&(r.status==="playing"||r.status==="loading")&&m.selectedPieceId===e&&await E(r.elapsedSeconds),D()}async function E(e=0){const t=L();if(!t){P("Select a track from the library.");return}const a=N(t);if(!a){P(oe.noMainScene);return}const s=await v.playFull({id:t.id,title:t.title,code:tt(a.code,et(t)),bpm:t.bpm,durationTargetMinutes:t.durationTargetMinutes,durationSeconds:W(t)},{offsetSeconds:Math.max(0,Number(e)||0)});s.message&&P(s.message)}async function st(e){if(await le,e.sourceKind==="scene"){const t=C.find(s=>s.id===e.pieceId),a=t==null?void 0:t.scenes.find(s=>s.id===e.sceneId);t&&a?rt(t,a):P("The selected scene is missing.");return}}function rt(e,t){const a=document.querySelector("[data-inspector]"),s=`${e.id}/${t.id}.strudel`;a.querySelector("[data-inspector-title]").textContent=s,a.querySelector("[data-inspector-editor]").value=t.code,a.querySelector("[data-source-path]").textContent=t.sourcePath??`pieces/${s}`,a.querySelector("[data-source-confirm]").hidden=!0,p={piece:e,scene:t,originalCode:t.code,triedCode:null,revision:t.sourceRevision??null};const r=a.querySelector('[data-action="prepare-source-save"]');r.disabled=!0,T(Pe(U,J)),a.showModal()}function X(){if(!p)return;p.triedCode=null;const e=document.querySelector("[data-inspector]");e.querySelector('[data-action="prepare-source-save"]').disabled=!0,e.querySelector("[data-source-confirm]").hidden=!0,T("Unsaved draft. Try it before preparing a permanent overwrite.")}const re=/^\[(?:cyclist|query|getTrigger|webaudio)\] error: /;let M=null;function fe(e){return`draft:${e.piece.id}:${e.scene.id}`}function be(e){var a;const t=v.getState();return((a=t.activeTrack)==null?void 0:a.id)===e&&(t.status==="playing"||t.status==="loading")}document.addEventListener("strudel.log",e=>{var a;const t=String(((a=e.detail)==null?void 0:a.message)??"");!M||!re.test(t)||!be(M.id)||(M.runtimeError??(M.runtimeError=t.replace(re,"")),(p==null?void 0:p.triedCode)!=null&&fe(p)===M.id&&he(M.runtimeError))});function he(e){p.triedCode=null;const t=document.querySelector("[data-inspector]");t.querySelector('[data-action="prepare-source-save"]').disabled=!0,t.querySelector("[data-source-confirm]").hidden=!0,T(`The draft failed while playing: ${e} The disk source is unchanged; fix the draft and try it again.`,!0)}async function nt(){if(!p)return;const e=document.querySelector("[data-inspector-editor]").value,t=document.querySelector("[data-inspector]");if(p.triedCode=null,t.querySelector('[data-action="prepare-source-save"]').disabled=!0,t.querySelector("[data-source-confirm]").hidden=!0,!e.trim()){T("The draft is empty. Add Strudel code before trying it.",!0);return}T("Evaluating the draft. The disk source remains unchanged.");const{piece:a,scene:s}=p,r=s.id==="main",i={id:fe(p),runtimeError:null};M=i;const c=await v.playFull({id:i.id,title:`${a.title} — ${s.name} draft`,code:e,bpm:a.bpm,durationTargetMinutes:r?a.durationTargetMinutes:null,durationSeconds:r?W(a):null});if(M!==i)return;if(!c.ok){M=null,T(`${c.message??"The draft could not be evaluated."} The disk source is unchanged.`,!0);return}if(i.runtimeError){he(i.runtimeError);return}if(!be(i.id)){T("The draft stopped before it played. Try it again before preparing an overwrite.",!0);return}p.triedCode=e;const n=document.querySelector('[data-action="prepare-source-save"]');n.disabled=!p.revision||!J.writeEnabled,T(Ae(U,!n.disabled))}function it(){if(!p)return;const e=document.querySelector("[data-inspector]"),t=e.querySelector("[data-inspector-editor]").value;if(!p.triedCode||p.triedCode!==t){X();return}const a=e.querySelector("[data-source-token]");a.value=sessionStorage.getItem("track-forge-source-editor-token")??"",e.querySelector("[data-source-confirm]").hidden=!1,T("Review the file path and confirm once more to overwrite the disk source."),a.focus()}async function ot(e){if(!p)return;const t=document.querySelector("[data-inspector]"),a=t.querySelector("[data-inspector-editor]").value,s=t.querySelector("[data-source-token]").value;if(p.triedCode!==a){X();return}if(!s){T("Enter the editor token before confirming the overwrite.",!0);return}e.disabled=!0,T("Writing the source atomically…");const r=await qe({pieceId:p.piece.id,sceneId:p.scene.id,code:a,expectedRevision:p.revision,editorToken:s});if(e.disabled=!1,!r.ok){const i=r.status===409?" Close and reopen the inspector before trying again.":"";T(`${r.error}${i}`,!0);return}p.scene.code=r.source.code,p.scene.sourceRevision=r.source.revision,p.scene.sourcePath=r.source.path,p.originalCode=r.source.code,p.revision=r.source.revision,p.triedCode=r.source.code,sessionStorage.setItem("track-forge-source-editor-token",s),t.querySelector("[data-source-confirm]").hidden=!0,t.querySelector('[data-action="prepare-source-save"]').disabled=!0,T("Saved to disk. The current draft is now the source of truth."),P(`${r.source.path} was overwritten after draft playback and confirmation.`)}function T(e,t=!1){const a=document.querySelector("[data-inspector-state]");a.textContent=e,a.classList.toggle("is-error",t)}window.addEventListener("keydown",async e=>{var a;if(e.key==="Escape"&&m.libraryOpen){m.libraryOpen=!1,j(),(a=f.querySelector(".library-toggle"))==null||a.focus();return}if(!(Ie(e.target)||document.querySelector("[data-inspector]").open||document.querySelector("[data-shortcuts]").open||document.querySelector("[data-samples]").open)){if(e.code==="Space"){if(e.preventDefault(),e.shiftKey){const s=await v.reset();!s.ok&&s.message&&P(s.message)}else await pe();return}if(e.key==="Escape"){await v.stop();return}}});window.matchMedia("(max-width: 920px)").addEventListener("change",()=>{window.matchMedia("(max-width: 920px)").matches||(m.libraryOpen=!1),j()});function j(){const e=f.querySelector(".library"),t=f.querySelector(".library-toggle"),a=window.matchMedia("(max-width: 920px)").matches,s=a&&m.libraryOpen;e.classList.toggle("is-open",m.libraryOpen),t.setAttribute("aria-expanded",String(m.libraryOpen)),e.inert=a&&!m.libraryOpen,f.querySelector(".stage").inert=s,f.querySelector(".transport").inert=s,f.querySelector(".topbar-identity").inert=s,f.querySelectorAll(".topbar-actions > :not(.library-toggle)").forEach(r=>{r.inert=s})}function P(e){const t=f.querySelector("[data-notice]");m.notice=e,t.textContent=e,t.hidden=!1,clearTimeout(ae),ae=setTimeout(()=>{t.hidden=!0,m.notice=null},7e3)}function L(){return C.find(e=>e.id===m.selectedPieceId)??null}function z(e,t){const a=e.sectionDescriptions;if(a&&typeof a=="object"){const s=a[t];return typeof s=="string"?s:""}return""}function W(e){var t;return typeof((t=e==null?void 0:e.timeline)==null?void 0:t.durationSeconds)=="number"&&e.timeline.durationSeconds>0?e.timeline.durationSeconds:typeof(e==null?void 0:e.durationSeconds)=="number"&&e.durationSeconds>0?e.durationSeconds:typeof(e==null?void 0:e.durationTargetMinutes)=="number"&&e.durationTargetMinutes>0?e.durationTargetMinutes*60:null}function ye(e){if(!e)return null;const t=W(e);if(t)return t;const a=lt(e);return a||Ue}function lt(e){if(!Array.isArray(e==null?void 0:e.arrangement))return null;const t=e.arrangement.map(a=>ge(a==null?void 0:a.at)).filter(a=>a>0);return t.length===0?null:Math.max(...t)+Re}function ge(e){if(typeof e!="string"||!/^\d+:\d{2}$/.test(e))return 0;const[t,a]=e.split(":").map(Number);return t*60+a}function ne(e,t,a){var c,n;const s=(n=(c=e.timeline)==null?void 0:c.layers)==null?void 0:n[t],i=(Array.isArray(s==null?void 0:s.segments)?s.segments:[]).filter(o=>o&&Number.isFinite(o.from)&&Number.isFinite(o.to)&&o.to>o.from).map(o=>({from:Math.max(0,Math.min(a,o.from)),to:Math.max(0,Math.min(a,o.to)),label:typeof o.label=="string"&&o.label?o.label:"Active",active:o.active!==!1})).filter(o=>o.to>o.from);return{family:typeof(s==null?void 0:s.family)=="string"&&s.family?s.family:t,segments:i.length>0?i:[{from:0,to:a,label:z(e,t)||"Active",active:!0}]}}function ve(e){const t=L(),a=ye(t);if(!a)return;const s=Math.min(a,Math.max(0,Number(e)||0)),r=s/a*100,i=f.querySelector("[data-stage-panel] .timeline-canvas"),c=f.querySelector("[data-stage-panel] [data-song-position]"),n=f.querySelector("[data-stage-panel] [data-timeline-position]"),o=f.querySelector("[data-stage-panel] [data-timeline-playhead-clock]");i==null||i.style.setProperty("--playhead",`${r}%`),c&&m.scrubPreviewSeconds===null&&(c.value=String(s)),c&&c.setAttribute("aria-valuetext",`${$(s)} of ${$(a)}`),n&&(n.textContent=`${$(s)} / ${$(a)}`),o&&(o.textContent=$(s))}function ct(e){var r,i,c,n;const t=e.rights.review,a=t.compositionStatus!=="not-claimed",s=["human-authored","ai-assisted-human-authored"].includes(t.compositionStatus);return[{label:e.release.distributionMode==="private-library"?"Private-library mode active; no public release":"Public-streaming mode selected",ok:!0},{label:e.release.monetizationEnabled?"Monetization enabled":"Monetization disabled",ok:!0},{label:"Metadata documented",ok:!!(e.title&&e.version&&e.bpm&&e.description&&e.durationTargetMinutes)},{label:e.artist.trim()?"Artist name documented":"Artist name missing",ok:e.artist.trim()!==""},{label:x(e.artwork)?"Artwork file documented":"Artwork not assigned",ok:x(e.artwork)},{label:(i=(r=e.artwork)==null?void 0:r.rights)!=null&&i.commercialUseChecked?"Artwork commercial-use review documented":"Artwork commercial-use review not completed",ok:!!((n=(c=e.artwork)==null?void 0:c.rights)!=null&&n.commercialUseChecked)},{label:t.compositionStatus==="undetermined"?"Composition status requires review":`Composition status: ${I(t.compositionStatus)}`,ok:t.compositionStatus!=="undetermined"},{label:a?e.rights.compositionOwner.trim()?"Composition owner documented":"Composition owner missing":"No composition rights claimed",ok:!a||e.rights.compositionOwner.trim()!==""},{label:s?t.humanContributionDocumented?"Human contribution documented":"Human contribution not documented":"Human contribution decision pending",ok:!s||t.humanContributionDocumented},{label:e.rights.masterOwner.trim()?"Master owner documented":"Master owner missing",ok:e.rights.masterOwner.trim()!==""},{label:t.masterStatus==="final"?"Final master documented":"Final master missing",ok:t.masterStatus==="final"},{label:!e.rights.aiAssisted||t.aiTermsChecked?"AI terms reviewed":"AI terms review not completed",ok:!e.rights.aiAssisted||t.aiTermsChecked},{label:e.rights.samples.length?"External samples declared":"No external samples declared",ok:!0},{label:t.sampleUseChecked?"Sample use reviewed":"Sample-use review not completed",ok:t.sampleUseChecked},{label:e.release.youtubeContentIdEnabled?"YouTube Content ID enabled":`YouTube Content ID disabled (${I(t.contentIdStatus)})`,ok:!e.release.youtubeContentIdEnabled||t.contentIdStatus==="eligible"},{label:e.rights.commercialUseChecked?"Commercial-use review documented":"Commercial-use review not completed",ok:e.rights.commercialUseChecked}]}function I(e){return String(e||"").split("-").map(t=>t.charAt(0).toUpperCase()+t.slice(1)).join(" ")}function d(e,t){const a=Array.isArray(t)?t.join(", "):t;return`
    <div>
      <dt>${e}</dt>
      <dd class="${a?"":"is-missing-text"}">${u(String(a||"Missing"))}</dd>
    </div>
  `}function dt(e){return e.length?e.map(t=>`${t.name}: ${t.source}`).join(", "):"No sample sources documented"}function $e(e){return e.split("-").map(t=>t.charAt(0).toUpperCase()+t.slice(1)).join(" ")}function u(e){return String(e).replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[t])}window.strudelWorkspace={pieces:C,transport:v};D();j();le.then(e=>{e.updated>0&&D()});
