/* Vinyl cutter + needle tracking AudioWorklet.
 *
 * Default velocity-input mode receives pre-emphasized stereo cutter velocity.
 * It performs the same leaky integration and 45/45 matrix as the TypeScript
 * geometry kernel, then applies finite stylus-radius tracing distortion and
 * differentiates back to cartridge velocity before external RIAA de-emphasis.
 *
 * inputIsVelocity = 0 instead interprets input channels as physical lateral
 * and vertical displacement in mm.
 */
class NeedleTrackingProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'radiusMm', defaultValue: 120, minValue: 45, maxValue: 150, automationRate: 'k-rate' },
      { name: 'stylusRadiusMm', defaultValue: 0.0152, minValue: 0.004, maxValue: 0.08, automationRate: 'k-rate' },
      { name: 'velocityGainMmPerSec', defaultValue: 82, minValue: 20, maxValue: 300, automationRate: 'k-rate' },
      { name: 'trackingMix', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'inputIsVelocity', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'dcServoHz', defaultValue: 18, minValue: 3, maxValue: 40, automationRate: 'k-rate' },
      { name: 'verticalTrim', defaultValue: 0.58, minValue: 0.2, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.intLeft = 0;
    this.intRight = 0;
    this.prevLateral = 0;
    this.prevTracedLateral = 0;
    this.prevVertical = 0;
    this.prevTracedVertical = 0;
  }

  readParam(param, index) {
    return param.length === 1 ? param[0] : param[index];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length < 1 || !output || output.length < 2) return true;

    const sourceL = input[0];
    const sourceR = input[1] || input[0];
    const leftOut = output[0];
    const rightOut = output[1] || output[0];
    const rpm = 33 + 1 / 3;
    const omegaDisc = (2 * Math.PI * rpm) / 60;
    const sqrt2 = Math.SQRT2;

    for (let i = 0; i < leftOut.length; i += 1) {
      const radius = this.readParam(parameters.radiusMm, i);
      const stylusRadius = this.readParam(parameters.stylusRadiusMm, i);
      const velocityGain = Math.max(1, this.readParam(parameters.velocityGainMmPerSec, i));
      const mix = this.readParam(parameters.trackingMix, i);
      const inputIsVelocity = this.readParam(parameters.inputIsVelocity, i) > 0.5;
      const dcServoHz = this.readParam(parameters.dcServoHz, i);
      const verticalTrim = this.readParam(parameters.verticalTrim, i);
      const linearVelocity = Math.max(8, omegaDisc * Math.max(8, radius));

      let x;
      let z;
      if (inputIsVelocity) {
        const leak = Math.exp((-2 * Math.PI * dcServoHz) / sampleRate);
        this.intLeft = leak * this.intLeft + (velocityGain * (sourceL[i] || 0)) / sampleRate;
        this.intRight = leak * this.intRight + (velocityGain * (sourceR[i] || 0)) / sampleRate;
        x = (this.intLeft + this.intRight) / sqrt2;
        z = verticalTrim * (this.intLeft - this.intRight) / sqrt2;
      } else {
        x = sourceL[i] || 0;
        z = sourceR[i] || 0;
      }

      const dxdt = (x - this.prevLateral) * sampleRate;
      this.prevLateral = x;
      const slope = dxdt / linearVelocity;
      const slope2 = slope * slope;
      const slope4 = slope2 * slope2;

      // Circular stylus normal-offset expansion plus contact onset term.
      const offset = -0.5 * stylusRadius * slope2 + 0.375 * stylusRadius * slope4;
      const contact = stylusRadius * 0.22 * Math.tanh(slope * 1.7) ** 3;
      const tracedX = x + mix * (offset + contact);
      const lateralVelocity = ((tracedX - this.prevTracedLateral) * sampleRate) / velocityGain;
      this.prevTracedLateral = tracedX;

      const dzdt = (z - this.prevVertical) * sampleRate;
      this.prevVertical = z;
      const zSlope = dzdt / linearVelocity;
      const tracedZ = z + mix * (
        -0.32 * stylusRadius * zSlope * zSlope +
        stylusRadius * 0.12 * Math.tanh(zSlope) ** 3
      );
      const verticalVelocity = ((tracedZ - this.prevTracedVertical) * sampleRate) / velocityGain;
      this.prevTracedVertical = tracedZ;

      leftOut[i] = (lateralVelocity + verticalVelocity) / sqrt2;
      rightOut[i] = (lateralVelocity - verticalVelocity) / sqrt2;
    }

    return true;
  }
}

registerProcessor('needle-tracking-processor', NeedleTrackingProcessor);
