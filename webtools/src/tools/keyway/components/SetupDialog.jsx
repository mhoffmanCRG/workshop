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
        <li>Bore the hub to size first. Clamp it with the bore upright and room below it for the overtravel; a through keyway needs the tool to clear the bottom face.</li>
        <li>Set X and Y zero so the bore centre lands where &ldquo;Bore centre&rdquo; says; indicate the bore, as any error moves the keyway off centre.</li>
        <li>Set Z zero on the top face of the hub (or wherever &ldquo;Top face&rdquo; says), with the tip of the cutting edge as the tool length reference.</li>
        <li>Measure the tool: the width of its cutting edge, how far the edge sits in front of the spindle axis, the head depth from the edge to its back face, and the length from the edge to the holder.</li>
        <li>Stop the spindle and hold it. With spindle orient (M19), set &ldquo;Orient angle&rdquo; to the M19 R value that points the cutting edge along +X; check it with the spindle oriented before the first run. Without orient, lock the spindle with the edge facing the keyway.</li>
        <li>Run the program in air first, with Z zero raised, and watch a few strokes: the tool must pull back before it goes up.</li>
        <li>Check the keyway width with a gauge or the key before the spring strokes are skipped; a dull edge or a sprung tool leaves it narrow.</li>
      </ol>
      <p><strong>The spindle must not turn while slotting.</strong> The program starts with M5 and never starts the spindle; do not start it by hand with this tool in. The cutting force goes straight up the Z axis and into the spindle lock, so keep the depth per stroke small.</p>
    </dialog>
  );
});

export default SetupDialog;
