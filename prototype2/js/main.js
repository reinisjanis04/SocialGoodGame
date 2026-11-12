const GAME = {
  state: null,
  scene: null,
  speed: 0,
  lastSpeed: 1,
  modeChosen: false,

  setSpeed(v) {
    if (v > 0) this.lastSpeed = v;
    this.speed = v;
    UI.update();
  },

  // Start a fresh game. mode = 'challenge' or 'endless'; null shows the start screen.
  restart(mode) {
    this.modeChosen = !!mode;
    this.state = SIM.newGame(mode || 'challenge');
    this.speed = 0;
    UI.reset();
    this.scene.scene.restart();
  },

  // Called by the scene clock (or the N key) at the end of every month.
  endMonth() {
    const s = this.state;
    SIM.endMonth(s);
    this.scene.monthClock = 0;
    UI.setMonthProgress(0);
    UI.refreshAll();
    (s.finished || []).forEach((f, i) => this.scene.time.delayedCall(i * 300, () => this.scene.floatText(f.c, f.r, f.text, f.good)));
    if (s.phase === 'event') UI.showEvent(s.pendingEvent);
    else if (s.phase === 'election') UI.showResult(SIM.runElection(s));
    else if (s.phase === 'over') UI.showResult(s.result);
  },
};

window.addEventListener('load', () => {
  GAME.state = SIM.newGame('challenge');
  UI.init();
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    pixelArt: true,
    backgroundColor: '#26343d',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: [CityScene],
  });
});
