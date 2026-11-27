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
        <li>Clamp the part clear of the holes, with something under it if the drill goes through: the warnings say when the tip passes the bottom.</li>
        <li>Set X and Y zero. Usually that is the pattern centre (centre 0,0): indicate the bore or boss the holes go round, as an error there moves every hole.</li>
        <li>Set Z zero to match &ldquo;Top of part&rdquo;, with the drill tip as the tool length reference.</li>
        <li>For holes bigger than about 6 mm, spot them first (cycle &ldquo;Spot drilling&rdquo; with a 90° spot drill), then drill with the same pattern. Tapped holes are drilled to the tap drill size first, deeper than the thread.</li>
        <li>Check the hole table against the drawing, then run the program in air with Z zero raised.</li>
        <li>Rigid tapping (G33.1) only works with a spindle encoder set up in LinuxCNC. Without one, tap by hand or with a floating tapping head.</li>
      </ol>
      <p>Between holes the tool goes back to the R plane (G99), just above the part, which is quickest. Pick &ldquo;Clearance height&rdquo; (G98) when clamps or a step stand higher than the R plane.</p>
    </dialog>
  );
});

export default SetupDialog;
