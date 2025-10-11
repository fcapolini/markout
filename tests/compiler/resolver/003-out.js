({
  id: 0,
  children: [
    {
      id: 1,
      name: 'page',
      children: [
        {
          id: 2,
          name: 'head',
          children: [
            {
              id: 3,
              name: 'style1',
              y: {
                exp: function() { return 1; }
              },
              children: []
            }
          ]
        },
        {
          id: 4,
          name: 'body',
          closed: true,
          children: [
            {
              id: 5,
              x: {
                exp: function() { return this.head.style1.y; },
                deps: [function() { return this.head.style1.$value('y'); }]
              },
              children: []
            }
          ]
        },
      ]
    }
  ]
})
