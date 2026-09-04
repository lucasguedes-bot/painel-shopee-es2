import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';

interface ItemRanking {
  name: string;
  fullName?: string;
  total?: number;
  bipsHora?: number;
  workstation?: string;
}

interface HoraAtiva {
  hora: string;
  top10: ItemRanking[];
}

interface ShiftData {
  totalBipsGeral: number;
  horas?: HoraAtiva[];
  rankingTotal?: ItemRanking[];
}

interface EsteiraData {
  shiftRanking: Record<string, ShiftData | null>;
}

type FullData = Record<string, EsteiraData>;

const SLOTS_TURNO: Record<string, number[]> = {
  T1: [6, 7, 8, 9, 10, 11, 12, 13],       // 06:00 as 14:00
  T2: [14, 15, 16, 17, 18, 19, 20, 21],   // 14:00 as 22:00
  T3: [22, 23, 0, 1, 2, 3, 4, 5],         // 22:00 as 06:00
};

function getTurnoAtualAutomatico(): string {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return 'T1';
  if (h >= 14 && h < 22) return 'T2';
  return 'T3';
}

function getTurnoDaHora(hora: number): string {
  if (hora >= 6 && hora < 14) return 'T1';
  if (hora >= 14 && hora < 22) return 'T2';
  return 'T3';
}

function formatarFaixaHora(horaInicio: number): string {
  const hInicioStr = String(horaInicio).padStart(2, '0');
  const hFimStr = String((horaInicio + 1) % 24).padStart(2, '0');
  return `${hInicioStr}:00 - ${hFimStr}:00`;
}

// Converte strings/timestamps UTC para o Horário Local do Navegador (ex: Brasília)
function extrairHoraNumeroLocal(dataVal: any): number | null {
  if (dataVal === null || dataVal === undefined || dataVal === '') return null;
  if (typeof dataVal === 'number' && Number.isFinite(dataVal)) {
    const h = Math.trunc(dataVal);
    return h >= 0 && h <= 23 ? h : null;
  }
  const str = String(dataVal).trim();
  if (/^\d{1,2}(?:\.0+)?$/.test(str)) {
    const h = Number(str);
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
  }
  const matchTime = str.match(/(?:T|\s|^)(\d{1,2}):\d{2}/);
  if (matchTime) {
    const h = Number(matchTime[1]);
    return h >= 0 && h <= 23 ? h : null;
  }
  return null;
}

function extrairOps(rawCell: any): string {
  if (rawCell === null || rawCell === undefined) return '';
  const str = String(rawCell).trim();
  const match = str.match(/Ops\s*\d+/i);
  return match ? `Ops${match[0].replace(/[^0-9]/g, '')}` : '';
}

function extrairNomeCompleto(rawCell: any): string {
  if (rawCell === null || rawCell === undefined) return '';
  const str = String(rawCell)
    .replace(/\[?Ops\s*\d+\]?/gi, '')
    .replace(/^\s*[|:-]\s*/, '')
    .trim();
  return /^operador$/i.test(str) ? '' : str;
}

function normalizarDataBanco(value: any): string {
  if (value === null || value === undefined) return '';
  const texto = String(value).trim();
  const match = texto.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const dateObj = new Date(texto);
  return isNaN(dateObj.getTime()) ? texto : dateObj.toISOString().slice(0, 10);
}

const processSupabaseData = (rows: any[]): FullData => {
  const result: FullData = {
    geral: { shiftRanking: { T1: null, T2: null, T3: null } },
    termo: { shiftRanking: { T1: null, T2: null, T3: null } },
    lona: { shiftRanking: { T1: null, T2: null, T3: null } },
    termo_nomes: { shiftRanking: { T1: null, T2: null, T3: null } },
    lona_nomes: { shiftRanking: { T1: null, T2: null, T3: null } },
    gestores: { shiftRanking: { T1: null, T2: null, T3: null } },
    inbound_bips: { shiftRanking: { T1: null, T2: null, T3: null } },
  };

  const turnos = ['T1', 'T2', 'T3'];

  turnos.forEach((turnoAlvo) => {
    const mapTermoOps = new Map<string, number>();
    const mapLonaOps = new Map<string, number>();
    const mapTermoNomes = new Map<string, number>();
    const mapLonaNomes = new Map<string, number>();

    const mapHorasInbound = new Map<string, Map<string, number>>();
    const mapHorasTermo = new Map<string, Map<string, number>>();
    const mapHorasLona = new Map<string, Map<string, number>>();
    const mapHorasTermoNomes = new Map<string, Map<string, number>>();
    const mapHorasLonaNomes = new Map<string, Map<string, number>>();

    rows.forEach((row) => {

      // 1. Mapeamento oficial da tabela produtividade
      const bipsTexto = String(row.processado ?? '0').trim();
      const bips = typeof row.processado === 'number' ? row.processado : Number(bipsTexto.replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
      if (isNaN(bips) || bips <= 0) return;

      // 2. A coluna hour é a hora da extração no SPX e orienta o turno.
      const horaNum = extrairHoraNumeroLocal(row.hour) ?? extrairHoraNumeroLocal(row.hora_entrada);
      if (horaNum === null) { console.warn('Registro descartado: hour inválido', row); return; }
      if (horaNum === null) return;

      const turnoInformado = String(row.turno ?? '').trim().toUpperCase();
      const turnoCalculado = getTurnoDaHora(horaNum);
      const turnoDoRegistro = ['T1', 'T2', 'T3'].includes(turnoInformado) ? turnoInformado : turnoCalculado;
      if (turnoDoRegistro !== turnoAlvo) return;

      // 3. ops_id contém o código OPS e o nome do colaborador.
      const valOpsId = row.ops_id;
      const valNome = row.ops_id;
      const atividade = String(row.atividade ?? '').trim().toLowerCase();
      const rawCellCombined = String(row.ops_id ?? row.ops_is ?? '').trim();
      const opsCode = extrairOps(rawCellCombined) || extrairOps(valOpsId) || (String(valOpsId ?? '').match(/\d{4,}/)?.[0] ? `Ops${String(valOpsId).match(/\d{4,}/)?.[0]}` : '');
      const fullName = extrairNomeCompleto(valNome) || extrairNomeCompleto(rawCellCombined);

      if (!opsCode && (!fullName || /^operador$/i.test(fullName))) return;

      const labelOpsNome = opsCode || fullName;
      const nomeOnly = fullName || opsCode;
      const workstation = String(row.workstation ?? '').toUpperCase().replace(/[\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      const faixaHoraStr = formatarFaixaHora(horaNum);

      // received representa Inbound e não depende de P1/P2.
      if (atividade === 'received') {
        mapHorasInbound.has(faixaHoraStr) || mapHorasInbound.set(faixaHoraStr, new Map());
        mapHorasInbound.get(faixaHoraStr)!.set(nomeOnly, (mapHorasInbound.get(faixaHoraStr)!.get(nomeOnly) || 0) + bips);
        return;
      }

      // packing representa as esteiras. A regra oficial é P1=Lona e P2=Termo.
      if (atividade !== 'packing') return;
      const isLona = workstation.includes('P1') || workstation.includes('LONA');
      const isTermo = workstation.includes('P2') || workstation.includes('TERMO');
      if (!isLona && !isTermo) return;

      if (isLona) {
        mapLonaOps.set(labelOpsNome, (mapLonaOps.get(labelOpsNome) || 0) + bips);
        mapLonaNomes.set(nomeOnly, (mapLonaNomes.get(nomeOnly) || 0) + bips);

        if (!mapHorasLona.has(faixaHoraStr)) mapHorasLona.set(faixaHoraStr, new Map());
        mapHorasLona.get(faixaHoraStr)!.set(labelOpsNome, (mapHorasLona.get(faixaHoraStr)!.get(labelOpsNome) || 0) + bips);

        if (!mapHorasLonaNomes.has(faixaHoraStr)) mapHorasLonaNomes.set(faixaHoraStr, new Map());
        mapHorasLonaNomes.get(faixaHoraStr)!.set(nomeOnly, (mapHorasLonaNomes.get(faixaHoraStr)!.get(nomeOnly) || 0) + bips);
      } else {
        mapTermoOps.set(labelOpsNome, (mapTermoOps.get(labelOpsNome) || 0) + bips);
        mapTermoNomes.set(nomeOnly, (mapTermoNomes.get(nomeOnly) || 0) + bips);

        if (!mapHorasTermo.has(faixaHoraStr)) mapHorasTermo.set(faixaHoraStr, new Map());
        mapHorasTermo.get(faixaHoraStr)!.set(labelOpsNome, (mapHorasTermo.get(faixaHoraStr)!.get(labelOpsNome) || 0) + bips);

        if (!mapHorasTermoNomes.has(faixaHoraStr)) mapHorasTermoNomes.set(faixaHoraStr, new Map());
        mapHorasTermoNomes.get(faixaHoraStr)!.set(nomeOnly, (mapHorasTermoNomes.get(faixaHoraStr)!.get(nomeOnly) || 0) + bips);
      }
    });

    const toSortedArray = (map: Map<string, number>, workstation?: string) =>
      Array.from(map.entries())
        .map(([name, total]) => ({ name, total, workstation }))
        .sort((a, b) => (b.total || 0) - (a.total || 0));

    const toHoraAtivaArray = (mapHora: Map<string, Map<string, number>>, turnoAtual: string, workstation?: string): HoraAtiva[] => {
      const slots = SLOTS_TURNO[turnoAtual] || [];
      return slots.map((hNum) => {
        const faixaLabel = formatarFaixaHora(hNum);
        const mapOps = mapHora.get(faixaLabel);
        const top10 = mapOps
          ? Array.from(mapOps.entries())
              .map(([name, bipsHora]) => ({ name, bipsHora, workstation }))
              .sort((a, b) => (b.bipsHora || 0) - (a.bipsHora || 0))
          : [];
        return { hora: faixaLabel, top10 };
      });
    };

    const calcTotalFromMap = (map: Map<string, number>) =>
      Array.from(map.values()).reduce((acc, val) => acc + val, 0);

    const calcTotalFromHorasMap = (mapHora: Map<string, Map<string, number>>) => {
      let tot = 0;
      mapHora.forEach((subMap) => subMap.forEach((val) => (tot += val)));
      return tot;
    };

    result.termo.shiftRanking[turnoAlvo] = {
      totalBipsGeral: calcTotalFromMap(mapTermoOps),
      rankingTotal: toSortedArray(mapTermoOps, 'P2'),
      horas: toHoraAtivaArray(mapHorasTermo, turnoAlvo, 'P2'),
    };

    result.lona.shiftRanking[turnoAlvo] = {
      totalBipsGeral: calcTotalFromMap(mapLonaOps),
      rankingTotal: toSortedArray(mapLonaOps, 'P1'),
      horas: toHoraAtivaArray(mapHorasLona, turnoAlvo, 'P1'),
    };

    result.termo_nomes.shiftRanking[turnoAlvo] = {
      totalBipsGeral: calcTotalFromMap(mapTermoNomes),
      rankingTotal: toSortedArray(mapTermoNomes, 'P2'),
      horas: toHoraAtivaArray(mapHorasTermoNomes, turnoAlvo, 'P2'),
    };

    result.lona_nomes.shiftRanking[turnoAlvo] = {
      totalBipsGeral: calcTotalFromMap(mapLonaNomes),
      rankingTotal: toSortedArray(mapLonaNomes, 'P1'),
      horas: toHoraAtivaArray(mapHorasLonaNomes, turnoAlvo, 'P1'),
    };

    result.inbound_bips.shiftRanking[turnoAlvo] = {
      totalBipsGeral: calcTotalFromHorasMap(mapHorasInbound),
      horas: toHoraAtivaArray(mapHorasInbound, turnoAlvo),
    };
  });

  return result;
};

export default function App() {
  const [fullData, setFullData] = useState<FullData | null>(null);
  const [currentEsteira, setCurrentEsteira] = useState<string>('geral');
  const [shiftSelect, setShiftSelect] = useState<string>(getTurnoAtualAutomatico());

  const todayStr = (() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  })();
  const [startDate, setStartDate] = useState<string>(todayStr);
  const [endDate, setEndDate] = useState<string>(todayStr);

  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>('');
  const [rowCount, setRowCount] = useState<number>(0);

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [targetAbaAposSenha, setTargetAbaAposSenha] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);

      // O turno é automático somente na inicialização. Depois, o usuário
      // pode selecionar T1, T2 ou T3 para consultar qualquer período.
      // Não sobrescrever a escolha manual a cada segundo.
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    setLoadError('');
    try {
      const { data, error } = await supabase
        .from('produtividade')
        .select('ops_id, workstation, grupo, atividade, horas_trabalhadas, projecao_hora, processado, hora_entrada, hora_saida, hour, date, turno')
        .order('date', { ascending: false })
        .order('hour', { ascending: false })
        .range(0, 9999);

      if (error) throw error;

      const dadosPeriodo = (data || []).filter((row: any) => {
        const dataLinha = normalizarDataBanco(row.date);
        return dataLinha >= startDate && dataLinha <= endDate;
      });

      setRowCount(dadosPeriodo.length);
      console.log('Linhas recebidas:', data?.length || 0, 'Linhas no período:', dadosPeriodo.length);
      if (dadosPeriodo.length > 0) {
        const parsed = processSupabaseData(dadosPeriodo);
        console.log('Ranking processado:', parsed);
        setFullData(parsed);
      } else {
        setFullData(null);
      }
    } catch (err: any) {
      const mensagem = err?.message || 'Erro desconhecido ao consultar o Supabase';
      setLoadError(mensagem);
      setFullData(null);
      console.error('Erro ao buscar dados do Supabase:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleSetEsteira = (type: string) => {
    if (['gestores', 'termo_nomes', 'lona_nomes', 'inbound_bips'].includes(type)) {
      setTargetAbaAposSenha(type);
      setPasswordInput('');
      setIsModalOpen(true);
    } else {
      setCurrentEsteira(type);
    }
  };

  const confirmarSenha = () => {
    if (passwordInput === '1010') {
      if (targetAbaAposSenha) setCurrentEsteira(targetAbaAposSenha);
      setIsModalOpen(false);
      setTargetAbaAposSenha(null);
    } else {
      alert('Senha incorreta! Acesso negado.');
      setPasswordInput('');
    }
  };

  const renderRankPosition = (idx: number) => {
    if (idx === 0) return <span className="rank medal-gold">🥇 1º</span>;
    if (idx === 1) return <span className="rank medal-silver">🥈 2º</span>;
    if (idx === 2) return <span className="rank medal-bronze">🥉 3º</span>;
    return <span className="rank">{idx + 1}º</span>;
  };

  const getGestoresConsolidatedData = () => {
    const termoNomesData = fullData?.termo_nomes?.shiftRanking;
    const lonaNomesData = fullData?.lona_nomes?.shiftRanking;

    const mapTermo = new Map<string, number>();
    const mapLona = new Map<string, number>();
    let totalBipsPer = 0;

    const termoShift = termoNomesData?.[shiftSelect];
    const lonaShift = lonaNomesData?.[shiftSelect];

    if (termoShift) {
      totalBipsPer += termoShift.totalBipsGeral || 0;
      (termoShift.rankingTotal || []).forEach((item) => {
        mapTermo.set(item.name, (mapTermo.get(item.name) || 0) + (item.total || 0));
      });
    }

    if (lonaShift) {
      totalBipsPer += lonaShift.totalBipsGeral || 0;
      (lonaShift.rankingTotal || []).forEach((item) => {
        mapLona.set(item.name, (mapLona.get(item.name) || 0) + (item.total || 0));
      });
    }

    const rankingTermoTotal: ItemRanking[] = Array.from(mapTermo.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => (b.total || 0) - (a.total || 0))
      .slice(0, 10);

    const rankingLonaTotal: ItemRanking[] = Array.from(mapLona.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => (b.total || 0) - (a.total || 0))
      .slice(0, 10);

    return {
      totalBipsGeral: totalBipsPer,
      rankingTermoTotal,
      rankingLonaTotal,
    };
  };

  const getCombinedRankingGeral = (): ItemRanking[] => {
    const termoList = fullData?.termo?.shiftRanking?.[shiftSelect]?.rankingTotal || [];
    const lonaList = fullData?.lona?.shiftRanking?.[shiftSelect]?.rankingTotal || [];

    const mapBips = new Map<string, number>();

    termoList.forEach((item) => {
      mapBips.set(item.name, (mapBips.get(item.name) || 0) + (item.total || 0));
    });

    lonaList.forEach((item) => {
      mapBips.set(item.name, (mapBips.get(item.name) || 0) + (item.total || 0));
    });

    return Array.from(mapBips.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => (b.total || 0) - (a.total || 0))
      .slice(0, 40);
  };

  const renderTable = (list?: ItemRanking[], isHora = false, limit: number | null = null) => {
    if (!list || list.length === 0) {
      return (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '8px 0', textAlign: 'center' }}>
          Sem bips nesta hora.
        </p>
      );
    }

    const displayList = limit ? list.slice(0, limit) : list;
    const isPublicTab = ['geral', 'termo', 'lona'].includes(currentEsteira);
    const colHeader = isPublicTab ? 'Nº DO OPS' : 'COLABORADOR';
    const valHeader = isHora ? 'Bips Hora' : 'TOTAL';

    return (
      <table>
        <thead>
          <tr>
            <th style={{ width: '50px' }}>#</th>
            <th style={{ whiteSpace: 'nowrap' }}>{colHeader}</th>
            <th style={{ textAlign: 'right', width: '80px', whiteSpace: 'nowrap' }}>{valHeader}</th>
          </tr>
        </thead>
        <tbody>
          {displayList.map((item, idx) => {
            const val = isHora ? item.bipsHora : item.total;
            return (
              <tr key={idx}>
                <td className="rank-col">{renderRankPosition(idx)}</td>
                <td className="name-col">{item.name}</td>
                <td className="bips">{(val || 0).toLocaleString('pt-BR')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const dataForEsteira = fullData?.[currentEsteira];

  // Mantém todas as faixas horárias visíveis mesmo quando ainda não há bips.
  const shiftData: ShiftData = dataForEsteira?.shiftRanking?.[shiftSelect] ?? {
    totalBipsGeral: 0,
    rankingTotal: [],
    horas: (SLOTS_TURNO[shiftSelect] || []).map((hora) => ({
      hora: formatarFaixaHora(hora),
      top10: [],
    })),
  };

  // Garante as faixas também quando há dados, mas alguma hora ainda está vazia.
  if (!shiftData.horas || shiftData.horas.length === 0) {
    shiftData.horas = (SLOTS_TURNO[shiftSelect] || []).map((hora) => ({
      hora: formatarFaixaHora(hora),
      top10: [],
    }));
  }

  const gestoresConsolidado = getGestoresConsolidatedData();

  const formatDateLabel = (dateStr: string) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const periodLabel = `${formatDateLabel(startDate)} a ${formatDateLabel(endDate)}`;

  const somaBipsBanner =
    currentEsteira === 'gestores'
      ? gestoresConsolidado.totalBipsGeral
      : currentEsteira === 'geral'
      ? (fullData?.termo?.shiftRanking?.[shiftSelect]?.totalBipsGeral || 0) +
        (fullData?.lona?.shiftRanking?.[shiftSelect]?.totalBipsGeral || 0)
      : shiftData?.totalBipsGeral || 0;

  return (
    <div className={`app-container ${darkMode ? 'dark-theme' : ''}`}>
      <style>{`
        * { box-sizing: border-box; }

        html, body, #root {
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          min-height: 100vh;
          background-color: var(--bg-color) !important;
        }

        :root {
          --shopee-red: #EE4D2D;
          --shopee-orange: #FF5722;
          --shopee-yellow: #FFBA00;
          --bg-color: #f4f6f8;
          --card-bg: #ffffff;
          --text-main: #222222;
          --text-muted: #666666;
          --border: #e2e8f0;
          --border-hover: #cbd5e1;
          --table-hover: #f8fafc;
        }

        .dark-theme {
          --bg-color: #1a1d21;
          --card-bg: #24282e;
          --text-main: #e2e8f0;
          --text-muted: #94a3b8;
          --border: #333942;
          --border-hover: #475569;
          --table-hover: #2d333b;
        }

        .app-container {
          width: 100%;
          min-height: 100vh;
          background-color: var(--bg-color);
          color: var(--text-main);
          font-family: system-ui, -apple-system, sans-serif;
          padding: 12px;
        }

        .shopee-header-bar {
          background: linear-gradient(135deg, var(--shopee-red) 0%, #ff7337 100%);
          border-radius: 10px;
          padding: 12px 16px;
          margin-bottom: 12px;
          color: #ffffff;
          box-shadow: 0 4px 10px rgba(238, 77, 45, 0.2);
        }

        .header-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
          flex-wrap: wrap;
          gap: 8px;
        }

        .shopee-brand-title {
          font-size: 1.5rem;
          font-weight: 900;
          letter-spacing: 0.5px;
          display: flex;
          align-items: center;
          gap: 6px;
          text-transform: uppercase;
        }

        .header-top-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .live-clock {
          background: rgba(0, 0, 0, 0.2);
          padding: 4px 10px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 0.8rem;
        }

        .btn-refresh {
          background: #ffffff;
          color: var(--shopee-red);
          border: none;
          padding: 5px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 800;
          font-size: 0.8rem;
          transition: transform 0.1s ease;
        }

        .btn-refresh:active {
          transform: scale(0.96);
        }

        .header-nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          background: rgba(255, 255, 255, 0.2);
          padding: 6px 10px;
          border-radius: 8px;
        }

        .btn-group {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .btn-group button {
          background: rgba(255, 255, 255, 0.9);
          border: none;
          color: #222;
          padding: 7px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 700;
          font-size: 0.75rem;
          transition: all 0.2s ease;
        }

        .btn-group button.active {
          background: #ffffff;
          color: var(--shopee-red);
          box-shadow: 0 2px 6px rgba(0,0,0,0.15);
        }

        .controls-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .date-range-box-small {
          display: flex;
          align-items: center;
          gap: 4px;
          background: rgba(255, 255, 255, 0.95);
          padding: 4px 8px;
          border-radius: 6px;
          color: #222;
          font-size: 0.75rem;
          font-weight: 700;
        }

        .input-control-small {
          background: transparent;
          color: inherit;
          border: none;
          font-weight: 600;
          font-size: 0.75rem;
          outline: none;
        }

        .select-control-small {
          background: rgba(255, 255, 255, 0.95);
          color: #222;
          padding: 5px 8px;
          border: none;
          border-radius: 6px;
          font-weight: 700;
          font-size: 0.75rem;
        }

        .btn-darkmode {
          background: rgba(0, 0, 0, 0.2);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.3);
          padding: 5px 10px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
          font-size: 0.78rem;
        }

        .banner-total {
          background: linear-gradient(135deg, var(--shopee-red) 0%, #ff7337 100%);
          color: #fff;
          padding: 10px 16px;
          border-radius: 10px;
          margin-bottom: 12px;
          text-align: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }

        .banner-total h2 {
          margin: 0 0 4px 0;
          font-size: 1rem;
          font-weight: 800;
        }

        .banner-total .val {
          font-size: 1.8rem;
          font-weight: 900;
          display: inline-block;
          background: rgba(255, 255, 255, 0.22);
          padding: 2px 16px;
          border-radius: 8px;
        }

        .esteira-layout-container {
          display: grid;
          grid-template-columns: 250px minmax(0, 1fr);
          gap: 12px;
          align-items: start;
          width: 100%;
          max-width: 100%;
          overflow: visible;
        }

        /* Coluna que conserva o espaço do ranking no grid. */
        .total-column {
          width: 250px;
          min-width: 0;
          align-self: start;
          overflow: visible;
        }

        /* O cartão fica preso ao topo da janela, sem sair da coluna. */
        .card-total-left {
          width: 250px;
          min-width: 0;
          height: fit-content;
          position: sticky;
          top: 12px;
          z-index: 20;
          background: var(--card-bg);
          box-shadow: 0 3px 8px rgba(0,0,0,0.06);
        }

        .esteira-layout-container > .horas-grid {
          grid-column: 2;
          width: 100%;
          min-width: 0;
          align-self: start;
        }

        .horas-grid {
          width: 100%;
          min-width: 0;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          align-items: stretch;
        }

        .card {
          background: var(--card-bg);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 8px 10px;
          box-shadow: 0 3px 6px rgba(0,0,0,0.03);
          min-width: 0;
        }

        .card-hora { border-top: 4px solid var(--shopee-orange); }
        .card-total { border-top: 4px solid var(--shopee-yellow); }

        .card-geral-full {
          width: 100%;
          max-width: 1000px;
          margin: 0 auto;
        }

        .card h3 {
          margin-top: 0;
          font-size: 0.85rem;
          border-bottom: 1px solid var(--border);
          padding-bottom: 6px;
          margin-bottom: 6px;
          text-align: center;
          font-weight: 800;
          text-transform: uppercase;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }

        th, td {
          padding: 4px 4px;
          text-align: left;
          font-size: 0.78rem;
          vertical-align: middle;
        }

        th {
          color: var(--text-muted);
          border-bottom: 1px solid var(--border);
          background: var(--card-bg);
          font-weight: 700;
          padding-bottom: 4px;
        }

        .name-col {
          word-break: break-word;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .rank-col {
          white-space: nowrap;
        }

        .rank {
          font-weight: 800;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          line-height: 1;
        }
        .medal-gold { color: #f59e0b; }
        .medal-silver { color: #94a3b8; }
        .medal-bronze { color: #d97706; }

        td.bips { text-align: right; font-weight: 800; color: var(--shopee-red); }
        tr:hover { background: var(--table-hover); }

        @media (max-width: 1180px) {
          .horas-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 850px) {
          .esteira-layout-container {
            grid-template-columns: 1fr;
          }
          .total-column {
            width: 100%;
          }
          .card-total-left {
            position: static !important;
            width: 100%;
            box-shadow: none;
          }
          .esteira-layout-container > .horas-grid {
            grid-column: auto;
          }
          .horas-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 560px) {
          .horas-grid {
            grid-template-columns: 1fr;
          }
          .app-container {
            padding: 8px;
          }
        }

        .modal-overlay {
          position: fixed;
          top: 0; left: 0; width: 100vw; height: 100vh;
          background: rgba(0, 0, 0, 0.6);
          display: flex; justify-content: center; align-items: center;
          z-index: 1000;
        }

        .modal-card {
          background: var(--card-bg);
          padding: 20px;
          border-radius: 10px;
          width: 300px;
          text-align: center;
          box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        }

        .modal-card input {
          width: 100%;
          padding: 8px;
          margin: 12px 0;
          border: 1px solid var(--border);
          border-radius: 6px;
          text-align: center;
          background: var(--bg-color);
          color: var(--text-main);
          font-size: 0.9rem;
        }
      `}</style>

      {/* HEADER SHOPEE */}
      <div className="shopee-header-bar">
        <div className="header-top">
          <div className="live-clock">
            📅 {currentTime.toLocaleDateString('pt-BR')} - 🕒{' '}
            {currentTime.toLocaleTimeString('pt-BR')}
          </div>

          <div className="shopee-brand-title">
            <span>🛍️ SHOPEE ES2</span>
            <span style={{ fontSize: '0.95rem', fontWeight: '600', opacity: 0.9 }}>
              | PAINEL OPERACIONAL
            </span>
          </div>

          <div className="header-top-right">
            <button className="btn-refresh" onClick={fetchData}>
              {isRefreshing ? '⏳' : '🔄 ATUALIZAR'}
            </button>

            <button className="btn-darkmode" onClick={() => setDarkMode(!darkMode)}>
              {darkMode ? '☀️ Modo Claro' : '🌙 Modo Escuro'}
            </button>
          </div>
        </div>

        <div className="header-nav">
          <div className="btn-group">
            <button
              className={currentEsteira === 'geral' ? 'active' : ''}
              onClick={() => handleSetEsteira('geral')}
            >
              🏆 RANKING GERAL
            </button>
            <button
              className={currentEsteira === 'termo' ? 'active' : ''}
              onClick={() => handleSetEsteira('termo')}
            >
              🔥 ESTEIRA TERMO
            </button>
            <button
              className={currentEsteira === 'lona' ? 'active' : ''}
              onClick={() => handleSetEsteira('lona')}
            >
              📦 ESTEIRA LONA
            </button>
            <button
              className={currentEsteira === 'termo_nomes' ? 'active' : ''}
              onClick={() => handleSetEsteira('termo_nomes')}
            >
              🔒 TERMO (NOMES)
            </button>
            <button
              className={currentEsteira === 'lona_nomes' ? 'active' : ''}
              onClick={() => handleSetEsteira('lona_nomes')}
            >
              🔒 LONA (NOMES)
            </button>
            <button
              className={currentEsteira === 'gestores' ? 'active' : ''}
              onClick={() => handleSetEsteira('gestores')}
            >
              👔 GESTORES
            </button>
            <button
              className={currentEsteira === 'inbound_bips' ? 'active' : ''}
              onClick={() => handleSetEsteira('inbound_bips')}
            >
              🔒 INBOUND BIPS
            </button>
          </div>

          <div className="controls-right">
            <div className="date-range-box-small">
              <span>De</span>
              <input
                type="date"
                className="input-control-small"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <span>Até</span>
              <input
                type="date"
                className="input-control-small"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>

            <select
              className="select-control-small"
              value={shiftSelect}
              onChange={(e) => setShiftSelect(e.target.value)}
            >
              <option value="T1">Turno T1 (06:00 as 14:00)</option>
              <option value="T2">Turno T2 (14:00 as 22:00)</option>
              <option value="T3">Turno T3 (22:00 as 06:00)</option>
            </select>
          </div>
        </div>
      </div>

      {loadError && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px', borderRadius: '8px', marginBottom: '12px', fontWeight: 700 }}>
          Erro ao carregar Supabase: {loadError}
        </div>
      )}
      {!loadError && rowCount === 0 && (
        <div style={{ background: '#fff7ed', color: '#9a3412', padding: '10px', borderRadius: '8px', marginBottom: '12px', fontWeight: 700 }}>
          Nenhum registro encontrado para {periodLabel}. Confira a data selecionada.
        </div>
      )}

      {/* BANNER TOTAL */}
      <div className="banner-total">
        <h2>
          TOTAL DE BIPS ({currentEsteira.replace('_', ' ').toUpperCase()}) -{' '}
          {currentEsteira === 'gestores'
            ? `PERÍODO (${periodLabel}) - TURNO ${shiftSelect}`
            : `TURNO ${shiftSelect}`}
        </h2>
        <div className="val">{somaBipsBanner.toLocaleString('pt-BR')} BIPS</div>
      </div>

      {/* CONTEÚDO */}
      {currentEsteira === 'geral' || currentEsteira === 'gestores' ||
       ['termo', 'lona', 'termo_nomes', 'lona_nomes', 'inbound_bips'].includes(currentEsteira) ? (
        <div style={{ width: '100%' }}>
          {currentEsteira === 'gestores' ? (
            <div className="card" style={{ width: '100%' }}>
              <h3 style={{ color: '#2563eb' }}>
                👔 GESTORES — TOP 10 CONSOLIDADO TERMO + LONA — PERÍODO: {periodLabel} | TURNO {shiftSelect}
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '16px',
                  width: '100%',
                  marginTop: '8px',
                }}
              >
                <div>
                  <h4 style={{ color: 'var(--shopee-red)', margin: '0 0 8px 0', textAlign: 'center', fontSize: '0.85rem' }}>
                    🔥 ESTEIRA TERMO (TURNO {shiftSelect})
                  </h4>
                  {renderTable(gestoresConsolidado.rankingTermoTotal, false, 10)}
                </div>
                <div>
                  <h4 style={{ color: '#059669', margin: '0 0 8px 0', textAlign: 'center', fontSize: '0.85rem' }}>
                    📦 ESTEIRA LONA (TURNO {shiftSelect})
                  </h4>
                  {renderTable(gestoresConsolidado.rankingLonaTotal, false, 10)}
                </div>
              </div>
            </div>
          ) : (
            <>
              {currentEsteira === 'inbound_bips' && (
                <div className="horas-grid">
                  {(shiftData?.horas || []).map((h, hIdx) => (
                    <div key={hIdx} className="card card-hora">
                      <h3 style={{ color: 'var(--shopee-red)' }}>
                        ⚡ Hora {h.hora}
                      </h3>
                      {renderTable(h.top10, true, 10)}
                    </div>
                  ))}
                </div>
              )}

              {['termo', 'lona', 'termo_nomes', 'lona_nomes'].includes(currentEsteira) && (
                <div className="esteira-layout-container">
                  <div className="total-column">
                    <div className="card card-total card-total-left">
                    <h3 style={{ color: 'var(--shopee-yellow)' }}>
                      🏆 TOTAL ACUMULADO TOP 10 ({shiftSelect})
                    </h3>
                    {renderTable(shiftData?.rankingTotal, false, 10)}
                    </div>
                  </div>

                  <div className="horas-grid">
                    {(shiftData?.horas || []).map((h, hIdx) => (
                      <div key={hIdx} className="card card-hora">
                        <h3 style={{ color: 'var(--shopee-orange)' }}>
                          ⚡ Hora {h.hora}
                        </h3>
                        {renderTable(h.top10, true, 10)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {currentEsteira === 'geral' && (
                <div className="card card-total card-geral-full">
                  <h3 style={{ color: 'var(--shopee-yellow)' }}>
                    🏆 RANKING GERAL (TERMO + LONA) - TOP 40 - TURNO {shiftSelect}
                  </h3>
                  <div>
                    {renderTable(getCombinedRankingGeral(), false, 40)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
          <p style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>
            Nenhum dado encontrado para as opções selecionadas.
          </p>
        </div>
      )}

      {/* MODAL DE AUTENTICAÇÃO */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h4 style={{ margin: '0 0 6px 0' }}>Acesso Restrito</h4>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Digite a senha para prosseguir:
            </p>
            <input
              type="password"
              placeholder="••••"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmarSenha()}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button onClick={() => setIsModalOpen(false)}>Cancelar</button>
              <button
                style={{
                  background: 'var(--shopee-red)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontWeight: 'bold'
                }}
                onClick={confirmarSenha}
              >
                Entrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Arquivo preservado e ajustado a partir da versão original: 1043 linhas. */
