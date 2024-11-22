const venom = require('venom-bot');
const fetch = require('node-fetch');

const pedidosURL = "https://sterileasy-ca5ed-default-rtdb.firebaseio.com/pedidos.json";
const catalogoURL = "https://sterileasy-ca5ed-default-rtdb.firebaseio.com/materiais.json";

let catalogo = {};
let pedidosPendentes = {};
let dadosCliente = {}; // Para armazenar dados temporariamente durante o fluxo de coleta

venom
  .create({
    session: 'whatsapp-bot',
    multidevice: true,
    headless: false
  })
  .then((client) => start(client))
  .catch((err) => {
    console.log('Erro ao iniciar o Venom Bot:', err);
  });

async function fetchCatalogo() {
  try {
    const response = await fetch(catalogoURL);
    catalogo = await response.json();
  } catch (error) {
    console.log('Erro ao buscar o catálogo:', error);
  }
}

function formatarCatalogo(catalogo) {
  return Object.keys(catalogo)
    .map((key, index) => `${index + 1}. ${catalogo[key].nome} - R$${parseFloat(catalogo[key].valor).toFixed(2)}`)
    .join('\n');
}

function start(client) {
  client.onMessage(async (message) => {
    const sender = message.from;

    // Fluxo de coleta de dados do cliente
    if (dadosCliente[sender] && !dadosCliente[sender].completo) {
      await coletarDadosCliente(client, message, sender);
      return;
    }

    if (pedidosPendentes[sender]) {
      const resposta = message.body.trim();
      if (resposta === '1') {
        if (!dadosCliente[sender]) {
          dadosCliente[sender] = { completo: false };
          await client.sendText(sender, 'Por favor, informe seu nome:');
        }
      } else if (resposta === '2') {
        await client.sendText(sender, 'Pedido cancelado.');
        delete pedidosPendentes[sender];
      } else {
        await client.sendText(sender, 'Por favor, responda com "1" para confirmar ou "2" para cancelar o pedido.');
      }
      return;
    }

    // Ajuste: Nova regex para validar pedidos no formato "2,2;3,3;1,1;"
    if (/^(\d+,\s*\d+;\s*)+$/m.test(message.body.trim())) {
      const pedidoTexto = message.body.trim();
      const pedidoItems = parsePedido(pedidoTexto);

      if (pedidoItems.error) {
        await client.sendText(sender, `Erro no pedido: ${pedidoItems.error}`);
        return;
      }

      const itensDetalhados = pedidoItems.items.map(item => {
        const idCatalogo = Object.keys(catalogo)[item.index - 1];
        const produto = catalogo[idCatalogo];
        return { nome: produto.nome, quantidade: item.quantidade, valor: parseFloat(produto.valor) };
      });

      const total = itensDetalhados.reduce((acc, item) => acc + item.valor * item.quantidade, 0);

      const resumoPedido = itensDetalhados
        .map(item => `${item.nome} x${item.quantidade} - R$${(item.valor * item.quantidade).toFixed(2)}`)
        .join('\n');

      await client.sendText(sender, `Resumo do pedido:\n${resumoPedido}\nTotal: R$${total.toFixed(2)}\n\nResponda com "1" para confirmar ou "2" para cancelar.`);

      pedidosPendentes[sender] = { itensDetalhados, total };
      return;
    }

    await fetchCatalogo();
    if (Object.keys(catalogo).length > 0) {
      const listaItens = formatarCatalogo(catalogo);
      await client.sendText(sender, `Olá! Aqui está o nosso catálogo:\n\n${listaItens}\n\nPara fazer um pedido, envie o número do item seguido da quantidade separados por vírgula, e cada item separado por ponto e vírgula. Exemplo:\n1,2; 3,1;`);
    } else {
      await client.sendText(sender, 'Desculpe, não foi possível carregar o catálogo no momento. Tente novamente mais tarde.');
    }
  });
}

async function coletarDadosCliente(client, message, sender) {
  const step = dadosCliente[sender].step || 'nome';

  switch (step) {
    case 'nome':
      dadosCliente[sender].nome = message.body.trim();
      dadosCliente[sender].step = 'email';
      await client.sendText(sender, 'Por favor, informe seu e-mail:');
      break;
    case 'email':
      dadosCliente[sender].email = message.body.trim();
      dadosCliente[sender].step = 'logradouro';
      await client.sendText(sender, 'Por favor, informe seu endereço (logradouro):');
      break;
    case 'logradouro':
      dadosCliente[sender].logradouro = message.body.trim();
      dadosCliente[sender].step = 'numero';
      await client.sendText(sender, 'Por favor, informe o número do endereço:');
      break;
    case 'numero':
      dadosCliente[sender].numero = message.body.trim();
      dadosCliente[sender].step = 'cep';
      await client.sendText(sender, 'Por favor, informe o CEP:');
      break;
    case 'cep':
      dadosCliente[sender].cep = message.body.trim();
      dadosCliente[sender].completo = true;
      await confirmarPedido(client, sender);
      break;
  }
}

async function confirmarPedido(client, sender) {
  try {
    const pedidoPendente = pedidosPendentes[sender];
    const clienteInfo = dadosCliente[sender];

    const cliente = {
      nome: clienteInfo.nome,
      telefone: sender,
      email: clienteInfo.email,
      endereco: {
        logradouro: clienteInfo.logradouro,
        numero: clienteInfo.numero,
        cep: clienteInfo.cep,
      },
    };

    const pedido = {
      cliente,
      status: 'pendente',
      itens: pedidoPendente.itensDetalhados,
      total: pedidoPendente.total,
      data: new Date().toISOString(),
    };

    await fetch(pedidosURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pedido),
    });

    await client.sendText(sender, `Pedido confirmado com sucesso! ✅\nObrigado por comprar conosco.`);
    delete pedidosPendentes[sender];
    delete dadosCliente[sender];
  } catch (error) {
    console.log('Erro ao confirmar o pedido:', error);
    await client.sendText(sender, 'Houve um erro ao confirmar seu pedido. Tente novamente mais tarde.');
  }
}

function parsePedido(pedidoTexto) {
  try {
    // Ajuste: Processa cada item terminado por ";"
    const linhas = pedidoTexto.split(';').filter(linha => linha.trim() !== '');
    const itens = linhas.map((linha, index) => {
      const partes = linha.split(',');
      if (partes.length < 2) {
        throw new Error(`Formato inválido no item ${index + 1}. Use "Número do Item, Quantidade;".`);
      }

      const indexItem = parseInt(partes[0].trim(), 10);
      const quantidade = parseInt(partes[1].trim(), 10);

      if (isNaN(indexItem) || isNaN(quantidade) || indexItem <= 0 || indexItem > Object.keys(catalogo).length) {
        throw new Error(`Número do item ou quantidade inválida no item ${index + 1}.`);
      }

      return { index: indexItem, quantidade };
    });

    return { items: itens };
  } catch (error) {
    console.log('Erro ao analisar o pedido:', error);
    return { error: error.message };
  }
}
