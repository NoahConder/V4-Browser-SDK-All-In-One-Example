import { createContext, useContext } from 'react';

// What the desktop workbench offers the phone column rendered inside it
// (components/Workbench.tsx provides it). Outside the workbench -- phones,
// tablets, short windows -- the context is null and the phone layout's own
// header panels and sheets apply.
export interface WorkbenchApi {
  // Select the Destinations pane's Subscribers tab (the identity chip's
  // action; on phones the chip opens the Subscriber panel instead).
  openSubscribers: () => void;
  // Select the Destinations pane's Recents tab (the address field's History
  // button; on phones it opens the resources panel on Recents).
  openRecents: () => void;
  // Select the Inspector's Quality tab (the quality badge's and the More
  // sheet's action; on phones they open the Call Statistics sheet instead).
  openCallStats: () => void;
}

export const WorkbenchContext = createContext<WorkbenchApi | null>(null);

export const useWorkbench = (): WorkbenchApi | null => useContext(WorkbenchContext);
