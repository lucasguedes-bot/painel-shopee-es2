import { supabase } from './supabaseClient.js';

function extrairOps(rawCell) {
  if (!rawCell) return '';
  const match = String(rawCell).match(/\[Ops\d+\]/i);
  return match ? match[0] : '';
}

function extrairNomeCompleto(rawCell) {
  if (!rawCell) return '';
  return String(rawCell).replace(/\[Ops\d+\]/gi, '').trim();
}

export async function obterDadosRanking() {
  const result = {
    geral: { shiftRanking: { T1: null, T2: null, T3: null } },
    p2_termo: { shiftRanking: { T1: null, T2: null, T3: null } },
    p1_lona: { shiftRanking: { T1: null, T2: null, T3: null } },
    p2_termo_nomes: { shiftRanking: { T1: null, T2: null, T3: null } },
    p1_lona_nomes: { shiftRanking: { T1: null, T2: null, T3: null } },
    gestores: { shiftRanking: { T1: null, T2: null, T3: null } },
    inbound_bips: { shiftRanking: { T1: null, T2: null, T3: null } },
  };

  try {
    const { data: dataRows, error } = await supabase
      .from('produtividade')
      .select('*')
      .order('id', { ascending: false })
      .limit(1000);

    if (error || !dataRows || dataRows.length === 0) {
      if (error) console.error('Erro ao buscar dados na tabela produtividade:', error);
      return result;
    }

    const turnos = ['T1', 'T2', 'T3'];

    turnos.forEach((turnoAtual) => {
      const mapGeralOps = new Map();
      const mapTermoOps = new Map();
      const mapLonaOps = new Map();
      const mapTermoNomes = new Map();
      const mapLonaNomes = new Map();

      const mapHorasInbound = new Map();
      const mapHorasTermo = new Map();
      const mapHorasLona = new Map();

      let totalTermo = 0;
      let totalLona = 0;
      let totalInbound = 0;
      let totalGeralBips = 0;

      dataRows.forEach((row) => {
        const totalBips = parseInt(row.processado || 0, 10);
        const rawCell = row.ops_id || '';
        const opsCode = extrairOps(rawCell);
        const fullName = extrairNomeCompleto(rawCell);
        
        const nameOpsFormat = opsCode ? `${opsCode} ${fullName}` : fullName || 'DESCONHECIDO';

        const workstation = String(row.workstation || '').toLowerCase();
        const atividade = String(row.atividade || '').toLowerCase();

        let horaStr = '00:00';
        if (row.hora_entrada) {
          const d = new Date(row.hora_entrada);
          if (!isNaN(d.getTime())) {
            horaStr = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          }
        }

        if (!isNaN(totalBips) && totalBips > 0) {
          const isTermo = workstation.includes('termo') || workstation.includes('p2') || atividade.includes('packing') || atividade.includes('p2');
          const isLona = workstation.includes('lona') || workstation.includes('p1') || workstation.includes('doca') || atividade.includes('line haul') || atividade.includes('p1');
          const isInbound = workstation.includes('receb') || workstation.includes('inbound') || atividade.includes('receiving') || atividade.includes('received') || atividade.includes('inbound');

          if (isTermo || isLona) {
            totalGeralBips += totalBips;
            mapGeralOps.set(nameOpsFormat, (mapGeralOps.get(nameOpsFormat) || 0) + totalBips);
          }

          if (isTermo) {
            totalTermo += totalBips;
            mapTermoOps.set(nameOpsFormat, (mapTermoOps.get(nameOpsFormat) || 0) + totalBips);
            mapTermoNomes.set(fullName, (mapTermoNomes.get(fullName) || 0) + totalBips);

            if (!mapHorasTermo.has(horaStr)) mapHorasTermo.set(horaStr, new Map());
            mapHorasTermo.get(horaStr).set(nameOpsFormat, (mapHorasTermo.get(horaStr).get(nameOpsFormat) || 0) + totalBips);

          } else if (isLona) {
            totalLona += totalBips;
            mapLonaOps.set(nameOpsFormat, (mapLonaOps.get(nameOpsFormat) || 0) + totalBips);
            mapLonaNomes.set(fullName, (mapLonaNomes.get(fullName) || 0) + totalBips);

            if (!mapHorasLona.has(horaStr)) mapHorasLona.set(horaStr, new Map());
            mapHorasLona.get(horaStr).set(nameOpsFormat, (mapHorasLona.get(horaStr).get(nameOpsFormat) || 0) + totalBips);

          } else if (isInbound) {
            totalInbound += totalBips;

            if (!mapHorasInbound.has(horaStr)) mapHorasInbound.set(horaStr, new Map());
            mapHorasInbound.get(horaStr).set(nameOpsFormat, (mapHorasInbound.get(horaStr).get(nameOpsFormat) || 0) + totalBips);
          }
        }
      });

      const toSortedArray = (map) =>
        Array.from(map.entries())
          .map(([name, total]) => ({ name, total }))
          .sort((a, b) => b.total - a.total);

      const toHoraAtivaArray = (mapHora) =>
        Array.from(mapHora.entries()).map(([hora, mapOps]) => ({
          hora,
          top10: Array.from(mapOps.entries())
            .map(([name, bipsHora]) => ({ name, bipsHora }))
            .sort((a, b) => b.bipsHora - a.bipsHora)
            .slice(0, 10),
        }));

      result.geral.shiftRanking[turnoAtual] = {
        totalBipsGeral: totalGeralBips,
        rankingTotal: toSortedArray(mapGeralOps),
      };

      result.p2_termo.shiftRanking[turnoAtual] = {
        totalBipsGeral: totalTermo,
        rankingTotal: toSortedArray(mapTermoOps),
        horas: toHoraAtivaArray(mapHorasTermo),
      };

      result.p1_lona.shiftRanking[turnoAtual] = {
        totalBipsGeral: totalLona,
        rankingTotal: toSortedArray(mapLonaOps),
        horas: toHoraAtivaArray(mapHorasLona),
      };

      result.p2_termo_nomes.shiftRanking[turnoAtual] = {
        totalBipsGeral: totalTermo,
        rankingTotal: toSortedArray(mapTermoNomes),
      };

      result.p1_lona_nomes.shiftRanking[turnoAtual] = {
        totalBipsGeral: totalLona,
        rankingTotal: toSortedArray(mapLonaNomes),
      };

      result.inbound_bips.shiftRanking[turnoAtual] = {
        totalBipsGeral: totalInbound,
        horas: toHoraAtivaArray(mapHorasInbound),
      };
    });

    return result;
  } catch (err) {
    console.error('Erro na leitura da tabela produtividade:', err);
    return result;
  }
}