/** Original synthesized sound; no downloads, samples or external services. */
export class AudioSystem {
 private context?:AudioContext;private last=0;private nextNote=0;private note=0;
 effects=.3;music=.08;muted=false;
 unlock(){try{this.context??=new AudioContext();void this.context.resume();}catch{}}
 tone(frequency:number,duration=.12,volume=1,wave:OscillatorType='sine'){if(!this.context||this.muted||this.effects===0)return;try{const c=this.context,o=c.createOscillator(),g=c.createGain();o.type=wave;o.frequency.setValueAtTime(frequency,c.currentTime);o.frequency.exponentialRampToValueAtTime(frequency*.7,c.currentTime+duration);g.gain.setValueAtTime(volume*this.effects*.12,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+duration);o.connect(g).connect(c.destination);o.start();o.stop(c.currentTime+duration);}catch{}}
 play(kind:string){const now=performance.now();if(now-this.last<65)return;this.last=now;const f=kind.includes('attack')?130:kind.includes('complete')||kind==='research'?660:kind==='error'?100:kind==='select'?420:kind==='move'?330:kind==='victory'?880:kind==='defeat'?110:240;this.tone(f,.1,kind==='attack'?.6:1,kind==='attack'?'triangle':'sine');}
 ambient(now:number){if(!this.context||this.muted||!this.music||now<this.nextNote)return;this.nextNote=now+1600;const scale=[146.83,220,261.63,293.66,329.63,220,196,164.81];try{const c=this.context,o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=scale[this.note++%scale.length];g.gain.setValueAtTime(0,c.currentTime);g.gain.linearRampToValueAtTime(this.music*.12,c.currentTime+.3);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+2.5);o.connect(g).connect(c.destination);o.start();o.stop(c.currentTime+2.5);}catch{}}
 destroy(){void this.context?.close();this.context=undefined;}
}
