import { forwardRef } from 'react';

// "Setting up the job", opened as a modal from the title bar.
const SetupDialog = forwardRef(function SetupDialog(_props, ref) {
  const close = () => { if (ref.current?.close) ref.current.close(); else ref.current?.removeAttribute('open'); };
  return (
    <dialog ref={ref} className="modal" aria-labelledby="setupTitle"
      // a click on the dimmed area outside the box closes it
      onClick={(e) => { if (e.target === ref.current) close(); }}>
      <div className="modal-head">
        <h2 id="setupTitle">Setting up the job</h2>
        <button type="button" className="quiet" aria-label="Close" onClick={close}>Close</button>
      </div>
      <ol>
        <li>Turn the stock to the outside diameter shown on the &ldquo;Turn stock to&rdquo; tile and hold it in the rotary axis. Support long stock with a tailstock.</li>
        <li>Set the cross-axis zero on the rotary centreline. An error here makes every groove lopsided, so indicate it carefully.</li>
        <li>Set Z zero to match the &ldquo;Z zero&rdquo; setting, with the tip of the ball-nose cutter as the reference.</li>
        <li>Set &ldquo;Rotary head is on the&rdquo; to the side of the table your rotary axis sits on, then set the long-axis zero so the &ldquo;start face position&rdquo; is the face the cutter enters from, normally the free end.</li>
        <li>Measure how far the cutter sticks out below the holder and enter it as &ldquo;Length below holder&rdquo;.</li>
        <li>If the top edges are tilted, jog the rotary positive, watch which way the top of the stock moves, and set &ldquo;Rotary + turns stock top toward&rdquo; to match.</li>
        <li>Run the program in air first, with Z zero raised, and watch the rotary through one full groove and one full turn.</li>
      </ol>
      <p>With tilt off and cross-axis offset positioning, the rotary only moves between grooves, so it can be locked while cutting and backlash does not affect the tooth form. With tilt on, it also turns between the top-edge passes.</p>
    </dialog>
  );
});

export default SetupDialog;
