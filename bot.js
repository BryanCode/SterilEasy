const venom = require('venom-bot');
const fetch = require('node-fetch');

const pedidosURL = "https://sterileasy-ca5ed-default-rtdb.firebaseio.com/pedidos.json";
const catalogoURL = "https://sterileasy-ca5ed-default-rtdb.firebaseio.com/materiais.json";

let catalogo = {};

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
    if (message.body.toLowerCase() === 'oi' || message.body.toLowerCase() === 'olá') {
      await fetchCatalogo();
      if (Object.keys(catalogo).length > 0) {
        const listaItens = formatarCatalogo(catalogo);
        await client.sendText(message.from, `Olá! Aqui está o nosso catálogo:\n\n${listaItens}\n\nPara fazer um pedido, envie "Pedido:" seguido do número do item e da quantidade. Exemplo:\nPedido: 1, 2`);
      } else {
        await client.sendText(message.from, 'Desculpe, não foi possível carregar o catálogo no momento. Tente novamente mais tarde.');
      }
    }

    if (message.body.startsWith('Pedido:')) {
      try {
        const pedidoTexto = message.body.replace('Pedido:', '').trim();
        const pedidoItems = parsePedido(pedidoTexto);

        if (pedidoItems.error) {
          await client.sendText(message.from, `Erro no pedido: ${pedidoItems.error}`);
          return;
        }

        const itensDetalhados = pedidoItems.items.map(item => {
          const idCatalogo = Object.keys(catalogo)[item.index - 1];
          const produto = catalogo[idCatalogo];
          return { nome: produto.nome, quantidade: item.quantidade, valor: parseFloat(produto.valor) };
        });

        const total = itensDetalhados.reduce((acc, item) => acc + item.valor * item.quantidade, 0);

        const cliente = {
          nome: message.sender.pushname || 'Cliente WhatsApp',
          telefone: message.sender.id,
          email: '',
          endereco: {
            cep: '',
            complemento: '',
            logradouro: '',
            numero: '',
          },
        };

        const pedido = {
          cliente,
          status: 'pendente',
          itens: itensDetalhados,
          total,
          data: new Date().toISOString(),
        };

        await fetch(pedidosURL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pedido),
        });

        const resumoPedido = itensDetalhados
          .map(item => `${item.nome} x${item.quantidade} - R$${(item.valor * item.quantidade).toFixed(2)}`)
          .join('\n');

        await client.sendText(message.from, `Resumo do pedido:\n${resumoPedido}\nTotal: R$${total.toFixed(2)}\nSeu pedido foi enviado com sucesso! ✅`);
      } catch (error) {
        console.log('Erro ao processar o pedido:', error);
        await client.sendText(message.from, 'Houve um erro ao processar seu pedido. Tente novamente mais tarde.');
      }
    }
  });
}

function parsePedido(pedidoTexto) {
  try {
    const linhas = pedidoTexto.split('\n');
    const itens = linhas.map((linha, index) => {
      const partes = linha.split(',');
      if (partes.length < 2) {
        throw new Error(`Formato inválido na linha ${index + 1}. Use "Número do Item, Quantidade".`);
      }

      const indexItem = parseInt(partes[0].trim(), 10);
      const quantidade = parseInt(partes[1].trim(), 10);

      if (isNaN(indexItem) || isNaN(quantidade) || indexItem <= 0 || indexItem > Object.keys(catalogo).length) {
        throw new Error(`Número do item ou quantidade inválida na linha ${index + 1}.`);
      }

      return { index: indexItem, quantidade };
    });

    return { items: itens };
  } catch (error) {
    console.log('Erro ao analisar o pedido:', error);
    return { error: error.message };
  }
}
