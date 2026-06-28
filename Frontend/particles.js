class ParticleSystem {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.numParticles = 400; 
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.init();
    this.animate();
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
  }

  init() {
    this.particles = [];
    for (let i = 0; i < this.numParticles; i++) {
      this.particles.push(this.createParticle(true));
    }
  }

  createParticle(randomRadius = false) {
    const angle = Math.random() * Math.PI * 2;
    // If randomRadius is true, scatter them. Otherwise, spawn near center.
    const radius = randomRadius ? Math.random() * Math.max(this.width, this.height) : Math.random() * 20;
    const speed = 0.2 + Math.random() * 1.5;
    const size = Math.random() * 1.5 + 0.5;
    
    // TrackingFoods / Antigravity Color Palette
    const colors = ['#4A90E2', '#FF9500', '#9B51E0', '#FFFFFF', '#FF3B30'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    return {
      angle: angle,
      radius: radius,
      speed: speed,
      size: size,
      color: color,
      rotationSpeed: (Math.random() - 0.5) * 0.005
    };
  }

  animate() {
    if (!document.getElementById(this.canvas.id)) return; // Stop if removed
    requestAnimationFrame(() => this.animate());
    
    // Clear canvas
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    for (let i = 0; i < this.particles.length; i++) {
      let p = this.particles[i];
      
      // Update
      p.angle += p.rotationSpeed; 
      p.radius += p.speed; 
      
      // Respawn near center if out of bounds
      if (p.radius > Math.max(this.width, this.height) / 1.2) {
        this.particles[i] = this.createParticle(false);
        p = this.particles[i];
      }

      // Calculate position
      const x = this.centerX + Math.cos(p.angle) * p.radius;
      const y = this.centerY + Math.sin(p.angle) * p.radius;
      
      // Draw as a small dash pointing outward
      const dashLength = p.size * 3;
      const endX = x + Math.cos(p.angle) * dashLength;
      const endY = y + Math.sin(p.angle) * dashLength;

      this.ctx.beginPath();
      this.ctx.moveTo(x, y);
      this.ctx.lineTo(endX, endY);
      this.ctx.strokeStyle = p.color;
      this.ctx.lineWidth = p.size;
      this.ctx.lineCap = 'round';
      
      // Fade based on distance to simulate 3D depth and smooth edge transition
      const maxRadius = Math.max(this.width, this.height) / 2;
      let alpha = 1;
      if (p.radius < 50) {
        alpha = p.radius / 50; // fade in at center
      } else if (p.radius > maxRadius * 0.7) {
        alpha = Math.max(0, 1 - ((p.radius - maxRadius * 0.7) / (maxRadius * 0.3))); // fade out at edge
      }
      
      this.ctx.globalAlpha = alpha;
      this.ctx.stroke();
    }
    this.ctx.globalAlpha = 1;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ParticleSystem('particle-canvas');
});
