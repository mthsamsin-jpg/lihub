// Motor do Robô de Lances no servidor: o mesmo código usado no navegador
// (site/js/robo-motor.js), para as regras e a trava do piso serem uma só.
import '../../site/js/robo-motor.js';

export const { STATUS, FASES, FASES_DE_LANCE, MARGEM_LC123, ehMeEpp, validarLimites, decidir, ordenarRanking, preferenciaLC123, Disputa, SalaSimulada, centavos } = globalThis.LHRobo;
