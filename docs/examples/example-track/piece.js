import metadata from './piece.json';
import main from './main.strudel?raw';
import pulse from './pulse.strudel?raw';
import skin from './skin.strudel?raw';
import seed from './seed.strudel?raw';
import tremor from './tremor.strudel?raw';
import memory from './memory.strudel?raw';
import ground from './ground.strudel?raw';

export default {
  ...metadata,
  sections: {
    main,
    pulse,
    skin,
    seed,
    tremor,
    memory,
    ground,
  },
};
