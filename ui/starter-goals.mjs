// Approved app scope, dated baseline, not a live metrics feed or a deadline.
export const starterGoals=[
 {id:'O2',title:'30 people, 30 hApps, 30 stories',target:30,current:null,unit:'people and hApps',context:'People outside software development build and explain a real hApp. No deadline.'},
 {id:'O3',title:'Reach international media, newsletters and podcasts',target:3,current:null,unit:'appearances',context:'Outcome not measured yet. Record independent publication links.'},
 {id:'U1',title:'Sustain worldwide Holochain search interest at 10+',target:10,current:2,unit:'Google Trends index',context:'Recorded 2026-11-04: October 2026 complete month = 2. Worldwide, all-time, Holochain search term, monthly. Relative index, not people or absolute searches; values can be rescaled. Historical peak: April 2021 = 100. This is a dated baseline, not a live feed.'},
 {id:'U2',title:'An institution uses Holochain for real work',target:1,current:null,unit:'institutions',context:'A school, cooperative, municipality or other institution describes its own actual use.'},
 {id:'U4',title:'A community carries outreach forward independently',target:null,current:null,unit:'',context:'Members create content and start projects without depending on RaiTurk. The organizer can define a measurable target.'},
].map(g=>({type:'goal',...g,archived:false}));
