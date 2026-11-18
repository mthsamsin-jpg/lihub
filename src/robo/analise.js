// Camada analítica do Robô Turbo 2.0 no servidor: o mesmo código do navegador
// (site/js/robo-analise.js), para a previsão ser igual na tela e no worker.
import '../../site/js/robo-analise.js';

export const { PerfilConcorrentes, MonitorPreditivo, estimarFechamento, ritmoDaPraca, desagioHistorico, analisar, phi, inversaPhi, DESAGIO_PADRAO } = globalThis.LHRoboAnalise;
