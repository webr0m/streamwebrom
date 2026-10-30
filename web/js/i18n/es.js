import { es as common } from "./es/common.js";
import { es as studio } from "./es/studio.js";
import { es as studiojs } from "./es/studiojs.js";
import { es as guest } from "./es/guest.js";
import { es as home } from "./es/home.js";
import { es as devices } from "./es/devices.js";
import { es as effects } from "./es/effects.js";
import { es as diagnostics } from "./es/diagnostics.js";
import { es as pages } from "./es/pages.js";
import { es as misc } from "./es/misc.js";

export const es = {
  ...common, ...studio, ...studiojs, ...guest, ...home, ...devices, ...effects, ...diagnostics, ...pages, ...misc,
};
