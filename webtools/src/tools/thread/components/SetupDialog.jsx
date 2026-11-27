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
        <li>For an inside thread, drill the hole to the size on the &ldquo;Drill hole&rdquo; tile, at least as deep as the thread plus the cutter&rsquo;s tip below its lowest tooth. For an outside thread, turn the boss to the &ldquo;Turn stock to&rdquo; size and leave room round it for the cutter.</li>
        <li>Set X and Y zero so the thread centres listed under &ldquo;Thread centres&rdquo; land on the holes or bosses. With one thread at 0,0, zero on the hole centre; indicate it, as an error here makes the thread lopsided.</li>
        <li>Set Z zero to match &ldquo;Top of thread&rdquo;, with the tip of the thread mill as the reference.</li>
        <li>Measure the cutter: its cutting diameter (over the teeth), how many teeth it has along its length and how far the lowest tooth&rsquo;s centre sits above the tip.</li>
        <li>Run the program in air first, with Z zero raised, and watch one full pass.</li>
        <li>Check the first thread with a gauge or the mating part before the spring pass is removed or the allowance changed. A thread that is too tight takes a little more allowance; the spring pass then cleans it up.</li>
      </ol>
      <p>Climb milling goes anticlockwise inside a hole and clockwise round a boss, with the spindle turning forward (M3). A right-hand thread is then cut from the bottom up inside, and from the top down outside.</p>
    </dialog>
  );
});

export default SetupDialog;
