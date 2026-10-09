"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileSearch, LockKeyhole, Network, Search, Server, Shield, ShieldAlert } from "lucide-react";
import type { CommandCenter } from "../lib/migraguard/socket";

const root="/console/migraguard";
const priority:Record<string,number>={critical:0,high:1,medium:2,low:3,info:4,unknown:5};
const closed=new Set(["resolved","closed","suppressed"]);
const fields=[
  ["edge","Edge / WAF","edge24h"],["identity","Identity","identity24h"],["api","API","api24h"],
  ["infrastructure","Infrastructure","infrastructure24h"],["secrets","Secrets","secrets24h"],
  ["supply-chain","Supply chain","supplyChain24h"],["content","Content","content24h"],
  ["mail","Mail","mail24h"],["malware","Malware","malware24h"],["monitoring","Monitoring","monitoring24h"],
] as const;
function Time({value}:{value:string|null}){
  if(!value)return <span>No evidence</span>;
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return <span>Unknown time</span>;
  return <time dateTime={value}>{new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"UTC",timeZoneName:"short"}).format(date)}</time>;
}
function Badge({value}:{value:string}){
  return <span className={`mg-badge mg-tone-${["critical","high","reporting","degraded"].includes(value)?value:"unknown"}`}>{value.replaceAll("_"," ")}</span>;
}

export function SecurityOverview({data}:{data:CommandCenter}){
  const [selected,setSelected]=useState<string|null>(null);
  const [search,setSearch]=useState("");
  const [status,setStatus]=useState("active");
  const asset=data.assets.rows.find(row=>row.name===selected);
  const active=useMemo(()=>data.incidents.items.filter(row=>!closed.has(row.status.toLowerCase())).sort((a,b)=>(priority[a.severity]??5)-(priority[b.severity]??5)||Date.parse(b.updatedAt||b.openedAt||"")-Date.parse(a.updatedAt||a.openedAt||"")),[data.incidents.items]);
  const incident=active[0];
  const incidents=data.incidents.items.filter(row=>(status==="all"||!closed.has(row.status.toLowerCase()))&&[row.title,row.summary,row.severity,row.status].join(" ").toLowerCase().includes(search.toLowerCase()));
  // Exact canonical asset association only. Never guess a relationship from a name substring.
  const evidence=asset?data.activity.filter(row=>row.assetName===asset.name):data.activity;
  return <div className="mg-overview">
    <div className="mg-overview-heading"><div><p className="mg-eyebrow">MIGRAGUARD / SECURITY OPERATIONS</p><h2>Security Overview</h2><p>Understand exposure. Prioritize response.</p></div><div className="mg-posture"><ShieldAlert size={21}/><div><span>Evidence-derived posture</span><strong>{data.overall.state.toUpperCase()}</strong><small>Last verified <Time value={data.overall.lastVerifiedAt}/></small></div></div></div>
    <div className="mg-overview-grid">
      <section className="mg-panel" aria-labelledby="mg-topology-heading">
        <div className="mg-panel-heading"><div><h3 id="mg-topology-heading">Defense Topology</h3><p>Observed asset coverage · {data.windowHours}-hour evidence window</p></div><Network size={20}/></div>
        <div className="mg-topology-root"><Shield size={22}/><div><strong>Canonical security evidence</strong><p>{data.audit.canonicalEvents} events · {data.assets.authoritative?"Authoritative asset inventory":"Event-producing assets only"}</p></div></div>
        <p className="mg-topology-note">Connections represent evidence coverage. Network dependencies are not yet verified.</p>{!data.assets.authoritative&&data.authorities?.find(item=>item.key==="assets")?.state==="connected"&&<p className="mg-topology-note">The registered inventory is empty. These are observed event-producing hosts, not registered protected assets.</p>}
        <div className="mg-asset-grid">
          {data.assets.rows.length===0?<p>No assets available in this bounded view.</p>:data.assets.rows.map(row=><button type="button" key={row.name} className={`mg-asset mg-state-${row.state}`} aria-pressed={selected===row.name} onClick={()=>setSelected(selected===row.name?null:row.name)}><span className="mg-asset-title"><Server size={17}/><strong>{row.name}</strong></span><Badge value={row.state}/><span>{row.evidence24h} evidence events</span><small><Time value={row.lastEvidenceAt}/></small></button>)}
        </div>
        <div className="mg-coverage-selection" aria-live="polite"><h4>{asset?`Coverage for ${asset.name}`:"Select an asset to inspect coverage"}</h4>{asset?<><div className="mg-domain-chips">{fields.filter(([, ,field])=>asset[field]>0).map(([key,label,field])=><Link key={key} href={key==="monitoring"?`${root}/monitoring`:`${root}/protection/${key}`}>{label} <strong>{asset[field]}</strong></Link>)}</div>{fields.every(([, ,field])=>asset[field]===0)&&<p>No canonical domain evidence for this asset. Protection state remains unknown.</p>}{asset.inventoryId&&<Link className="mg-text-link" href={`${root}/assets/${encodeURIComponent(asset.inventoryId)}`}>Open authoritative asset record <ArrowRight size={15}/></Link>}</>:<p>{data.assets.reporting} reporting · {data.assets.degraded} degraded · {data.assets.offline} stale. Reporting describes telemetry availability.</p>}</div>
      </section>
      <section className="mg-panel mg-priority" aria-labelledby="mg-priority-heading">
        <div className="mg-panel-heading"><h3 id="mg-priority-heading">Priority incident</h3>{incident&&<Badge value={incident.severity}/>}</div>
        {!data.incidents.connected?<div role="status"><h4>Incident authority unavailable</h4><p>Active incidents cannot be verified.</p></div>:!incident?<div><h4>No active incident in this view</h4><p>The connected source has no active records in the loaded set. Check evidence and coverage gaps below.</p></div>:<><h4>{incident.title}</h4><p>{incident.summary}</p><dl className="mg-incident-meta"><div><dt>State</dt><dd>{incident.status}</dd></div><div><dt>Opened</dt><dd><Time value={incident.openedAt}/></dd></div><div><dt>Updated</dt><dd><Time value={incident.updatedAt}/></dd></div></dl><Link className="mg-primary-link" href={`${root}/incidents/${encodeURIComponent(incident.id)}`}>Review incident <ArrowRight size={17}/></Link></>}
        <div className="mg-evidence-heading"><h4>{asset?"Selected asset evidence":"Recent canonical evidence"}</h4><Link href={`${root}/activity`}>View activity <ArrowRight size={14}/></Link></div>
        <p className="mg-topology-note">Incident evidence and governed response linkage are available inside the case record.</p>
        <ol className="mg-evidence-list">{evidence.slice(0,4).map(row=><li key={row.id}><Badge value={row.severity}/><strong>{row.title}</strong><small><Time value={row.timestamp}/></small><details><summary><FileSearch size={14}/>Inspect evidence</summary><p>{row.source} → {row.target}</p><p>{row.detection} · {row.action} · {row.state}</p><ul>{row.evidence.map((item,index)=><li key={index}>{item}</li>)}</ul><code>{row.evidenceId}</code></details></li>)}</ol>
        {evidence.length===0&&<p>No matching canonical evidence in the loaded activity sample.</p>}
      </section>
    </div>
    <section className="mg-panel" aria-labelledby="mg-queue-heading"><div className="mg-panel-heading"><div><h3 id="mg-queue-heading">Recent incidents</h3><p>Persisted cases · {data.incidents.items.length} loaded records</p></div><Link className="mg-text-link" href={`${root}/incidents`}>View all incidents <ArrowRight size={16}/></Link></div>
      <div className="mg-queue-filters"><label><Search size={16}/><span className="sr-only">Search overview incidents</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search incident, severity, or state"/></label><label><span className="sr-only">Overview incident state</span><select value={status} onChange={event=>setStatus(event.target.value)}><option value="active">Active incidents</option><option value="all">All loaded incidents</option></select></label></div>
      {!data.incidents.connected?<p role="status">Incident feed unavailable. Counts are unknown.</p>:<div className="mg-queue-scroll"><table><thead><tr><th>Opened (UTC)</th><th>Severity</th><th>Incident</th><th>Context</th><th>State</th><th>Updated (UTC)</th></tr></thead><tbody>{incidents.slice(0,12).map(row=><tr key={row.id}><td><Time value={row.openedAt}/></td><td><Badge value={row.severity}/></td><td><Link href={`${root}/incidents/${encodeURIComponent(row.id)}`}>{row.title}</Link></td><td>{row.summary}</td><td>{row.status}</td><td><Time value={row.updatedAt}/></td></tr>)}</tbody></table>{incidents.length===0&&<p role="status">No incidents match this filter.</p>}</div>}
    </section>
    <div className="mg-authority-strip"><LockKeyhole size={19}/><div><strong>{data.response.authority==="governed"?"Governed response authority connected":"Response authority unavailable"}</strong><p>Executor disabled · Automatic remediation off · {data.response.authority==="governed"?`${data.response.pendingApprovals} pending approvals`:"Approval state unknown"}</p></div><Link href={`${root}/response`}>Review authority <ArrowRight size={16}/></Link></div>
  </div>;
}
