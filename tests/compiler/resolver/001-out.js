({
  __id: 0,
  __children: [
    {
      __id: 1,
      __name: 'page',
      __children: [
        {
          __id: 2,
          __name: 'head',
          y: {
            e: function() { return 1; }
          },
          __children: []
        },
        {
          __id: 3,
          __name: 'body',
          x: {
            e: function() { return this.head.y; },
            r: [function() { return this.head.$value('y'); }]
          },
          __children: []
        },
      ]
    }
  ]
})
