import p5 from 'p5';

new p5((p) => {
  p.setup = () => {
    p.createCanvas(800, 600);
  };

  p.draw = () => {
    p.background(14, 14, 17);
    p.noStroke();
    p.fill(127, 179, 163);
    p.circle(p.width / 2 + Math.sin(p.frameCount * 0.02) * 100, p.height / 2, 40);
  };
});
